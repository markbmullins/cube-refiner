import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  listPersistedCardScores,
  listPersistedMatrixRows,
  replaceCardScoreRows,
  upsertPipelineRun
} from "../db/index.js";
import type { CardArchetypeMatrixInput, CardScoreInput } from "../db/repository.js";
import type { CardScoreRow } from "../types/contracts.js";

export type ScoringConfig = {
  readonly glueAffinityThreshold: number;
  readonly signpostAffinityThreshold: number;
  readonly signpostExclusivityThreshold: number;
  readonly signpostMinDecksWithCard: number;
  readonly cubeWeights: {
    readonly glue: number;
    readonly frequency: number;
    readonly signpost: number;
    readonly nostalgia: number;
    readonly sideboardOnlyPenalty: number;
    readonly parasiticPenalty: number;
  };
  readonly nostalgiaScores: Readonly<Record<string, number>>;
  readonly parasiticWhitelist: readonly string[];
};

export type ScoreCardsOptions = Partial<ScoringConfig> & {
  readonly cardsRankedCsvPath?: string;
  readonly glueCardsCsvPath?: string;
  readonly parasiticReviewCsvPath?: string;
  readonly pipelineRunId: string;
  readonly signpostCandidatesCsvPath?: string;
};

export type ScoreCardsSummary = {
  readonly cardsRankedCsvPath?: string;
  readonly glueCardsCsvPath?: string;
  readonly parasiticReviewCsvPath?: string;
  readonly pipelineRunId: string;
  readonly scoreRows: number;
  readonly signpostCandidatesCsvPath?: string;
};

const defaultScoringConfig: ScoringConfig = {
  cubeWeights: {
    frequency: 0.25,
    glue: 0.45,
    nostalgia: 0.1,
    parasiticPenalty: 0.15,
    sideboardOnlyPenalty: 0.2,
    signpost: 0.2
  },
  glueAffinityThreshold: 0.1,
  nostalgiaScores: {},
  parasiticWhitelist: [],
  signpostAffinityThreshold: 0.6,
  signpostExclusivityThreshold: 0.4,
  signpostMinDecksWithCard: 5
};

export function scoreCards(database: DatabaseSync, options: ScoreCardsOptions): ScoreCardsSummary {
  const config = mergeScoringConfig(options);
  const configHash = stableConfigHash({ ...config, pipelineRunId: options.pipelineRunId, stage: "card-scores" });
  upsertPipelineRun(database, {
    configHash,
    id: options.pipelineRunId,
    status: "running"
  });

  try {
    const matrixRows = listPersistedMatrixRows(database, options.pipelineRunId);
    const scoreRows = calculateCardScores(matrixRows, config).map((row) => ({
      ...row,
      pipelineRunId: options.pipelineRunId
    }));
    replaceCardScoreRows(database, options.pipelineRunId, scoreRows);
    const persistedRows = listPersistedCardScores(database, options.pipelineRunId);

    if (options.cardsRankedCsvPath) {
      writeScoreCsv(options.cardsRankedCsvPath, persistedRows);
    }
    if (options.signpostCandidatesCsvPath) {
      writeScoreCsv(
        options.signpostCandidatesCsvPath,
        persistedRows.filter((row) => isSignpostCandidate(row, config))
      );
    }
    if (options.glueCardsCsvPath) {
      writeScoreCsv(options.glueCardsCsvPath, persistedRows.filter((row) => row.glueScore > 0));
    }
    if (options.parasiticReviewCsvPath) {
      writeScoreCsv(options.parasiticReviewCsvPath, persistedRows.filter((row) => row.parasiticScore > 0));
    }

    upsertPipelineRun(database, {
      completedAt: new Date().toISOString(),
      configHash,
      id: options.pipelineRunId,
      status: "completed"
    });

    return {
      cardsRankedCsvPath: options.cardsRankedCsvPath,
      glueCardsCsvPath: options.glueCardsCsvPath,
      parasiticReviewCsvPath: options.parasiticReviewCsvPath,
      pipelineRunId: options.pipelineRunId,
      scoreRows: persistedRows.length,
      signpostCandidatesCsvPath: options.signpostCandidatesCsvPath
    };
  } catch (error) {
    upsertPipelineRun(database, {
      completedAt: new Date().toISOString(),
      configHash,
      id: options.pipelineRunId,
      status: "failed"
    });
    throw error;
  }
}

export function calculateCardScores(
  matrixRows: readonly Pick<
    CardArchetypeMatrixInput,
    | "cardName"
    | "decksWithCard"
    | "mainboardCopies"
    | "sideboardCopies"
    | "affinity"
  >[],
  config: ScoringConfig = defaultScoringConfig
): readonly CardScoreRow[] {
  const rowsByCard = new Map<string, typeof matrixRows>();
  for (const row of matrixRows) {
    rowsByCard.set(row.cardName, [...(rowsByCard.get(row.cardName) ?? []), row]);
  }

  const baseRows = [...rowsByCard.entries()].map(([cardName, rows]) => {
    const affinities = rows.map((row) => row.affinity).sort((a, b) => b - a);
    const frequency = rows.reduce((total, row) => total + row.decksWithCard, 0);
    const mainboardCopies = rows.reduce((total, row) => total + row.mainboardCopies, 0);
    const sideboardCopies = rows.reduce((total, row) => total + row.sideboardCopies, 0);
    const qualifyingRows = rows.filter((row) => row.affinity >= config.glueAffinityThreshold);
    const highestAffinity = affinities[0] ?? 0;
    const secondHighestAffinity = affinities[1] ?? 0;
    const exclusivityScore = highestAffinity - secondHighestAffinity;
    const signpostScore = highestAffinity * exclusivityScore * Math.log(1 + frequency);

    return {
      cardName,
      exclusivityScore,
      frequency,
      glueScore: qualifyingRows.length,
      highestAffinity,
      mainboardCopies,
      secondHighestAffinity,
      sideboardCopies,
      signpostScore,
      weightedGlueScore: qualifyingRows.reduce((total, row) => total + Math.log(1 + row.decksWithCard), 0)
    };
  });

  const maxWeightedGlue = maxValue(baseRows.map((row) => row.weightedGlueScore));
  const maxFrequency = maxValue(baseRows.map((row) => row.frequency));
  const maxSignpost = maxValue(baseRows.map((row) => row.signpostScore));
  const whitelist = new Set(config.parasiticWhitelist.map((cardName) => cardName.toLowerCase()));

  return baseRows
    .map((row) => {
      const normalizedGlue = normalize(row.weightedGlueScore, maxWeightedGlue);
      const normalizedFrequency = normalize(row.frequency, maxFrequency);
      const normalizedSignpost = normalize(row.signpostScore, maxSignpost);
      const totalCopies = row.mainboardCopies + row.sideboardCopies;
      const sideboardOnlyScore = totalCopies === 0 ? 0 : row.sideboardCopies / totalCopies;
      const nostalgiaScore = clamp01(config.nostalgiaScores[row.cardName] ?? 0);
      const parasiticScore = whitelist.has(row.cardName.toLowerCase())
        ? 0
        : Math.max(0, normalizedSignpost - normalizedGlue);
      const cubeScore =
        config.cubeWeights.glue * normalizedGlue +
        config.cubeWeights.frequency * normalizedFrequency +
        config.cubeWeights.signpost * normalizedSignpost +
        config.cubeWeights.nostalgia * nostalgiaScore -
        config.cubeWeights.sideboardOnlyPenalty * sideboardOnlyScore -
        config.cubeWeights.parasiticPenalty * parasiticScore;

      return {
        cardName: row.cardName,
        cubeScore,
        exclusivityScore: row.exclusivityScore,
        frequency: row.frequency,
        glueScore: row.glueScore,
        highestAffinity: row.highestAffinity,
        parasiticScore,
        secondHighestAffinity: row.secondHighestAffinity,
        signpostScore: row.signpostScore,
        weightedGlueScore: row.weightedGlueScore
      };
    })
    .sort((a, b) => b.cubeScore - a.cubeScore || a.cardName.localeCompare(b.cardName));
}

export function isSignpostCandidate(row: CardScoreRow, config: ScoringConfig = defaultScoringConfig): boolean {
  return (
    row.highestAffinity >= config.signpostAffinityThreshold &&
    row.exclusivityScore >= config.signpostExclusivityThreshold &&
    row.frequency >= config.signpostMinDecksWithCard
  );
}

function writeScoreCsv(filePath: string, rows: readonly CardScoreInput[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "card_name,frequency,glue_score,weighted_glue_score,highest_affinity,second_highest_affinity,exclusivity_score,signpost_score,parasitic_score,cube_score",
      ...rows.map((row) =>
        [
          row.cardName,
          formatNumber(row.frequency),
          formatNumber(row.glueScore),
          formatNumber(row.weightedGlueScore),
          formatNumber(row.highestAffinity),
          formatNumber(row.secondHighestAffinity),
          formatNumber(row.exclusivityScore),
          formatNumber(row.signpostScore),
          formatNumber(row.parasiticScore),
          formatNumber(row.cubeScore)
        ].map(csvEscape).join(",")
      )
    ].join("\n") + "\n"
  );
}

function mergeScoringConfig(options: ScoreCardsOptions): ScoringConfig {
  const numericOptions = removeUndefined({
    glueAffinityThreshold: options.glueAffinityThreshold,
    signpostAffinityThreshold: options.signpostAffinityThreshold,
    signpostExclusivityThreshold: options.signpostExclusivityThreshold,
    signpostMinDecksWithCard: options.signpostMinDecksWithCard
  });

  return {
    ...defaultScoringConfig,
    ...numericOptions,
    cubeWeights: {
      ...defaultScoringConfig.cubeWeights,
      ...(options.cubeWeights ?? {})
    },
    nostalgiaScores: options.nostalgiaScores ?? defaultScoringConfig.nostalgiaScores,
    parasiticWhitelist: options.parasiticWhitelist ?? defaultScoringConfig.parasiticWhitelist
  };
}

function removeUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function normalize(value: number, max: number): number {
  return max === 0 ? 0 : value / max;
}

function maxValue(values: readonly number[]): number {
  return values.reduce((max, value) => Math.max(max, value), 0);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/g, "").replace(/\.$/, "");
}

function csvEscape(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, "\"\"")}"`;
}

function stableConfigHash(config: unknown): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}
