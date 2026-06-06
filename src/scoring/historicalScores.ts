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
import type { CardScoreRow } from "../types/contracts.js";
import type { HistoricalCardRole, HistoricalCardScoreRow } from "../types/contracts.js";

export type HistoricalScoreWeights = {
  readonly glue: number;
  readonly longevity: number;
  readonly peak: number;
  readonly archetypeImportance: number;
  readonly periodVariancePenalty: number;
  readonly signpost: number;
  readonly parasitic: number;
};

export type HistoricalScoreNormalization = {
  readonly eraScore: "count" | "share";
  readonly peakScore: "raw" | "sqrt";
  readonly longevityScore: "share" | "count";
  readonly periodVariance: "tracked" | "penalty";
};

export type HistoricalScoreThresholds = {
  readonly eraShare: number;
  readonly pillarLongevity: number;
  readonly pillarPeak: number;
  readonly iconPeak: number;
  readonly flashPeak: number;
  readonly flashMaxLongevity: number;
};

export type HistoricalRoleOverride = {
  readonly cardName: string;
  readonly role?: HistoricalCardRole;
  readonly include?: boolean;
  readonly exclude?: boolean;
  readonly scoreAdjustment?: number;
  readonly reason?: string;
};

export type HistoricalScoreConfig = {
  readonly normalization: HistoricalScoreNormalization;
  readonly weights: HistoricalScoreWeights;
  readonly thresholds: HistoricalScoreThresholds;
  readonly manualOverrides: readonly HistoricalRoleOverride[];
};

export type ScoreHistoricalCardsOptions = Partial<HistoricalScoreConfig> & {
  readonly pipelineRunId: string;
  readonly aggregatePipelineRunId?: string;
  readonly configHash?: string;
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
  manualOverrides: [],
  normalization: {
    eraScore: "count",
    longevityScore: "share",
    peakScore: "raw",
    periodVariance: "tracked"
  },
  weights: {
    archetypeImportance: 0.15,
    glue: 0.2,
    longevity: 0.35,
    parasitic: 0,
    peak: 0.3,
    periodVariancePenalty: 0,
    signpost: 0
  }
};

export function scoreHistoricalCards(
  database: DatabaseSync,
  options: ScoreHistoricalCardsOptions
): ScoreHistoricalCardsSummary {
  const config = mergeHistoricalScoreConfig(options);
  const aggregatePipelineRunId = options.aggregatePipelineRunId ?? options.pipelineRunId;
  const configHash = options.configHash ?? stableConfigHash({ aggregatePipelineRunId, config, stage: "score:historical" });
  const aggregateScores = new Map(listPersistedCardScores(database, aggregatePipelineRunId).map((row) => [row.cardName, row]));
  const rows = calculateHistoricalCardScores(
    listHistoricalScoreInputRows(database, options.pipelineRunId),
    listMetagamePeriods(database).length,
    aggregateScores,
    config,
    options.pipelineRunId,
    configHash
  );

  upsertPipelineRun(database, {
    completedAt: new Date().toISOString(),
    configHash,
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
  aggregateScores: ReadonlyMap<string, CardScoreRow>,
  config: HistoricalScoreConfig = defaultHistoricalScoreConfig,
  pipelineRunId = "historical-score",
  configHash?: string
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
      const eraCount = rows.filter((row) => row.metagameShare >= config.thresholds.eraShare).length;
      const eraScore = normalizeEraScore(eraCount, totalPeriods, config.normalization.eraScore);
      const rawPeakScore = Math.max(0, ...shares);
      const peakScore = normalizePeakScore(rawPeakScore, config.normalization.peakScore);
      const longevityScore = normalizeLongevityScore(eraCount, totalPeriods, config.normalization.longevityScore);
      const periodVariance = variance([...shares, ...Array(Math.max(0, totalPeriods - shares.length)).fill(0)]);
      const archetypeImportanceScore = new Set(rows.flatMap((row) => row.archetypeFamilies)).size / maxArchetypeCount;
      const aggregateScore = aggregateScores.get(cardName);
      const glueScore = aggregateScore?.weightedGlueScore ?? 0;
      const signpostScore = aggregateScore?.signpostScore ?? 0;
      const parasiticScore = aggregateScore?.parasiticScore ?? 0;
      const variancePenalty = config.normalization.periodVariance === "penalty" ? periodVariance * config.weights.periodVariancePenalty : 0;
      const baseModernLegacyScore =
        glueScore * config.weights.glue +
        signpostScore * config.weights.signpost -
        parasiticScore * config.weights.parasitic +
        longevityScore * config.weights.longevity +
        peakScore * config.weights.peak +
        archetypeImportanceScore * config.weights.archetypeImportance -
        variancePenalty;
      const automaticRole = classifyHistoricalRole(rows, longevityScore, rawPeakScore, config.thresholds);
      const override = config.manualOverrides.find((entry) => entry.cardName === cardName);
      const modernLegacyScore = override?.exclude === true ? 0 : Math.max(0, baseModernLegacyScore + (override?.scoreAdjustment ?? 0));
      const role = override?.exclude === true ? "role_player" : override?.role ?? automaticRole;

      return {
        archetypeImportanceScore,
        cardName,
        config,
        configHash,
        eraScore,
        explanation: explainScore(cardName, role, automaticRole, eraCount, rawPeakScore, longevityScore, config, override),
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
    manualOverrides: options.manualOverrides ?? defaultHistoricalScoreConfig.manualOverrides,
    normalization: {
      ...defaultHistoricalScoreConfig.normalization,
      ...(options.normalization ?? {})
    },
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
  automaticRole: HistoricalCardRole,
  eraCount: number,
  peakScore: number,
  longevityScore: number,
  config: HistoricalScoreConfig,
  override?: HistoricalRoleOverride
): string {
  const reasons = [
    `${cardName} classified as ${role}`,
    `automatic_role=${automaticRole}`,
    `present_periods=${formatNumber(eraCount)} at min_share=${formatNumber(config.thresholds.eraShare)}`,
    `peak=${formatNumber(peakScore)} icon_threshold=${formatNumber(config.thresholds.iconPeak)} flash_threshold=${formatNumber(config.thresholds.flashPeak)}`,
    `longevity=${formatNumber(longevityScore)} pillar_threshold=${formatNumber(config.thresholds.pillarLongevity)}`
  ];
  if (override) {
    reasons.push(`manual_override=${override.reason ?? "configured"}`);
  }
  return `${reasons.join("; ")}.`;
}

function normalizeEraScore(eraCount: number, totalPeriods: number, mode: HistoricalScoreNormalization["eraScore"]): number {
  return mode === "share" ? (totalPeriods <= 0 ? 0 : eraCount / totalPeriods) : eraCount;
}

function normalizePeakScore(peakScore: number, mode: HistoricalScoreNormalization["peakScore"]): number {
  return mode === "sqrt" ? Math.sqrt(peakScore) : peakScore;
}

function normalizeLongevityScore(eraCount: number, totalPeriods: number, mode: HistoricalScoreNormalization["longevityScore"]): number {
  return mode === "count" ? eraCount : totalPeriods <= 0 ? 0 : eraCount / totalPeriods;
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
