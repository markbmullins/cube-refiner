import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  listHistoricalCardScoreRows,
  listHistoricalScoreInputRows,
  listPersistedCardScores,
  listMetagamePeriods,
  replaceHistoricalCardScoreRows,
  upsertPipelineRun
} from "../db/index.js";
import type { HistoricalScoreInputRow } from "../db/repository.js";
import type { HistoricalCardRole, HistoricalCardScoreRow } from "../types/contracts.js";

export type HistoricalScoreWeights = {
  readonly glue: number;
  readonly longevity: number;
  readonly peak: number;
  readonly archetypeImportance: number;
};

export type HistoricalScoreThresholds = {
  readonly eraShare: number;
  readonly pillarLongevity: number;
  readonly pillarPeak: number;
  readonly iconPeak: number;
  readonly flashPeak: number;
  readonly flashMaxLongevity: number;
};

export type HistoricalScoreConfig = {
  readonly weights: HistoricalScoreWeights;
  readonly thresholds: HistoricalScoreThresholds;
};

export type ScoreHistoricalCardsOptions = Partial<HistoricalScoreConfig> & {
  readonly pipelineRunId: string;
  readonly aggregatePipelineRunId?: string;
  readonly historicalCardsRankedCsvPath?: string;
  readonly formatPillarsCsvPath?: string;
  readonly archetypeIconsCsvPath?: string;
  readonly flashInPanReviewCsvPath?: string;
};

export type ScoreHistoricalCardsSummary = {
  readonly pipelineRunId: string;
  readonly scoreRows: number;
  readonly historicalCardsRankedCsvPath?: string;
  readonly formatPillarsCsvPath?: string;
  readonly archetypeIconsCsvPath?: string;
  readonly flashInPanReviewCsvPath?: string;
};

export const defaultHistoricalScoreConfig: HistoricalScoreConfig = {
  thresholds: {
    eraShare: 0.05,
    flashMaxLongevity: 0.25,
    flashPeak: 0.25,
    iconPeak: 0.18,
    pillarLongevity: 0.5,
    pillarPeak: 0.08
  },
  weights: {
    archetypeImportance: 0.15,
    glue: 0.2,
    longevity: 0.35,
    peak: 0.3
  }
};

export function scoreHistoricalCards(
  database: DatabaseSync,
  options: ScoreHistoricalCardsOptions
): ScoreHistoricalCardsSummary {
  const config = mergeHistoricalScoreConfig(options);
  const aggregatePipelineRunId = options.aggregatePipelineRunId ?? options.pipelineRunId;
  const aggregateScores = new Map(
    listPersistedCardScores(database, aggregatePipelineRunId).map((row) => [row.cardName, row.weightedGlueScore])
  );
  const rows = calculateHistoricalCardScores(
    listHistoricalScoreInputRows(database, options.pipelineRunId),
    listMetagamePeriods(database).length,
    aggregateScores,
    config,
    options.pipelineRunId
  );

  upsertPipelineRun(database, {
    completedAt: new Date().toISOString(),
    configHash: stableConfigHash({ aggregatePipelineRunId, config, stage: "score:historical" }),
    id: options.pipelineRunId,
    status: "completed"
  });
  replaceHistoricalCardScoreRows(database, options.pipelineRunId, rows);
  const persistedRows = listHistoricalCardScoreRows(database, options.pipelineRunId);

  if (options.historicalCardsRankedCsvPath) {
    writeHistoricalScoresCsv(options.historicalCardsRankedCsvPath, persistedRows);
  }
  if (options.formatPillarsCsvPath) {
    writeHistoricalScoresCsv(options.formatPillarsCsvPath, persistedRows.filter((row) => row.historicalRole === "format_pillar"));
  }
  if (options.archetypeIconsCsvPath) {
    writeHistoricalScoresCsv(options.archetypeIconsCsvPath, persistedRows.filter((row) => row.historicalRole === "archetype_icon"));
  }
  if (options.flashInPanReviewCsvPath) {
    writeHistoricalScoresCsv(options.flashInPanReviewCsvPath, persistedRows.filter((row) => row.historicalRole === "flash_in_the_pan"));
  }

  return {
    archetypeIconsCsvPath: options.archetypeIconsCsvPath,
    flashInPanReviewCsvPath: options.flashInPanReviewCsvPath,
    formatPillarsCsvPath: options.formatPillarsCsvPath,
    historicalCardsRankedCsvPath: options.historicalCardsRankedCsvPath,
    pipelineRunId: options.pipelineRunId,
    scoreRows: persistedRows.length
  };
}

export function calculateHistoricalCardScores(
  inputRows: readonly HistoricalScoreInputRow[],
  totalPeriods: number,
  glueScores: ReadonlyMap<string, number>,
  config: HistoricalScoreConfig = defaultHistoricalScoreConfig,
  pipelineRunId = "historical-score"
): readonly HistoricalCardScoreRow[] {
  const rowsByCard = new Map<string, HistoricalScoreInputRow[]>();
  for (const row of inputRows) {
    rowsByCard.set(row.cardName, [...(rowsByCard.get(row.cardName) ?? []), row]);
  }

  const maxArchetypeCount = Math.max(
    1,
    ...[...rowsByCard.values()].map((rows) => new Set(rows.flatMap((row) => row.archetypeFamilies)).size)
  );

  return [...rowsByCard.entries()]
    .map(([cardName, rows]) => {
      const shares = rows.map((row) => row.metagameShare);
      const eraScore = rows.filter((row) => row.metagameShare >= config.thresholds.eraShare).length;
      const peakScore = Math.max(0, ...shares);
      const longevityScore = totalPeriods <= 0 ? 0 : eraScore / totalPeriods;
      const periodVariance = variance([...shares, ...Array(Math.max(0, totalPeriods - shares.length)).fill(0)]);
      const archetypeImportanceScore = new Set(rows.flatMap((row) => row.archetypeFamilies)).size / maxArchetypeCount;
      const glueScore = glueScores.get(cardName) ?? 0;
      const modernLegacyScore =
        glueScore * config.weights.glue +
        longevityScore * config.weights.longevity +
        peakScore * config.weights.peak +
        archetypeImportanceScore * config.weights.archetypeImportance;
      const role = classifyHistoricalRole(rows, longevityScore, peakScore, config.thresholds);

      return {
        archetypeImportanceScore,
        cardName,
        config,
        eraScore,
        explanation: explainScore(cardName, role, eraScore, peakScore, longevityScore),
        glueScore,
        historicalRole: role,
        longevityScore,
        modernLegacyScore,
        peakScore,
        periodVariance,
        pipelineRunId
      };
    })
    .sort((left, right) => right.modernLegacyScore - left.modernLegacyScore || left.cardName.localeCompare(right.cardName));
}

function classifyHistoricalRole(
  rows: readonly HistoricalScoreInputRow[],
  longevityScore: number,
  peakScore: number,
  thresholds: HistoricalScoreThresholds
): HistoricalCardRole {
  const mainboardCopies = rows.reduce((total, row) => total + row.mainboardCopies, 0);
  const sideboardCopies = rows.reduce((total, row) => total + row.sideboardCopies, 0);
  if (longevityScore >= thresholds.pillarLongevity && peakScore >= thresholds.pillarPeak) {
    return "format_pillar";
  }
  if (peakScore >= thresholds.flashPeak && longevityScore <= thresholds.flashMaxLongevity && sideboardCopies > mainboardCopies) {
    return "flash_in_the_pan";
  }
  if (peakScore >= thresholds.iconPeak) {
    return "archetype_icon";
  }

  return "role_player";
}

function mergeHistoricalScoreConfig(options: Partial<HistoricalScoreConfig>): HistoricalScoreConfig {
  return {
    thresholds: {
      ...defaultHistoricalScoreConfig.thresholds,
      ...(options.thresholds ?? {})
    },
    weights: {
      ...defaultHistoricalScoreConfig.weights,
      ...(options.weights ?? {})
    }
  };
}

function explainScore(
  cardName: string,
  role: HistoricalCardRole,
  eraScore: number,
  peakScore: number,
  longevityScore: number
): string {
  return `${cardName} classified as ${role}; era_score=${formatNumber(eraScore)}, peak=${formatNumber(peakScore)}, longevity=${formatNumber(longevityScore)}.`;
}

function writeHistoricalScoresCsv(filePath: string, rows: readonly HistoricalCardScoreRow[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "card_name,modern_legacy_score,historical_role,era_score,peak_score,longevity_score,period_variance,archetype_importance_score,glue_score,explanation",
      ...rows.map((row) =>
        [
          row.cardName,
          formatNumber(row.modernLegacyScore),
          row.historicalRole,
          formatNumber(row.eraScore),
          formatNumber(row.peakScore),
          formatNumber(row.longevityScore),
          formatNumber(row.periodVariance),
          formatNumber(row.archetypeImportanceScore),
          formatNumber(row.glueScore),
          row.explanation
        ].map(csvEscape).join(",")
      )
    ].join("\n") + "\n"
  );
}

function variance(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
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
