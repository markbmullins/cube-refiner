import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  getEcosystemDiversitySummary,
  listArchetypeReconstructionTargets,
  listCubeArchetypeReconstructionRows,
  listCubeRunCards,
  listHistoricalCardScoreRows,
  listHistoricalValidationMetrics,
  listHistoricalValidationWarnings,
  listMetagamePeriods,
  registerOutputArtifact,
  replaceHistoricalValidationRows,
  upsertHistoricalValidationRun
} from "../db/index.js";
import type {
  CubeArchetypeReconstructionRow,
  HistoricalValidationMetricRow,
  HistoricalValidationStatus,
  HistoricalValidationWarningRow
} from "../types/contracts.js";

export type HistoricalCubeValidationConfig = {
  readonly minimumPeriodCoverage: number;
  readonly maximumPeriodCoverage: number;
  readonly minimumFormatPillars: number;
  readonly minimumArchetypeIcons: number;
  readonly maximumFlashInThePan: number;
  readonly minimumReconstructionScore: number;
  readonly minimumEcosystemDiversityScore: number;
};

export type ValidateHistoricalCubeOptions = Partial<HistoricalCubeValidationConfig> & {
  readonly configHash?: string;
  readonly cubeRunId: string;
  readonly pipelineRunId: string;
  readonly validationRunId?: string;
  readonly historicalValidationCsvPath?: string;
  readonly historicalPeriodCoverageCsvPath?: string;
  readonly historicalArchetypeReconstructionCsvPath?: string;
};

export type ValidateHistoricalCubeSummary = {
  readonly validationRunId: string;
  readonly status: HistoricalValidationStatus;
  readonly metrics: number;
  readonly warnings: number;
  readonly historicalValidationCsvPath?: string;
  readonly historicalPeriodCoverageCsvPath?: string;
  readonly historicalArchetypeReconstructionCsvPath?: string;
};

const defaultConfig: HistoricalCubeValidationConfig = {
  maximumFlashInThePan: 18,
  maximumPeriodCoverage: 80,
  minimumArchetypeIcons: 20,
  minimumEcosystemDiversityScore: 0.4,
  minimumFormatPillars: 20,
  minimumPeriodCoverage: 2,
  minimumReconstructionScore: 0.5
};

export function validateHistoricalCube(
  database: DatabaseSync,
  options: ValidateHistoricalCubeOptions
): ValidateHistoricalCubeSummary {
  const config = mergeConfig(options);
  const validationRunId = options.validationRunId ?? randomUUID();
  const cubeCards = new Set(listCubeRunCards(database, options.cubeRunId).map((card) => card.cardName));
  const periods = listMetagamePeriods(database);
  const targets = listArchetypeReconstructionTargets(database, options.pipelineRunId);
  const reconstructionRows = listCubeArchetypeReconstructionRows(database, options.cubeRunId, options.pipelineRunId);
  const ecosystem = getEcosystemDiversitySummary(database, options.cubeRunId, options.pipelineRunId);
  const historicalScores = listHistoricalCardScoreRows(database, options.pipelineRunId);
  const periodCoverage = periodCoverageRows(periods.map((period) => period.periodId), targets, cubeCards);
  const metrics = validationMetrics(validationRunId, periodCoverage, reconstructionRows, ecosystem, historicalScores, cubeCards);
  const warnings = validationWarnings(validationRunId, options.cubeRunId, options.pipelineRunId, periodCoverage, reconstructionRows, historicalScores, cubeCards, ecosystem, config);
  const status = validationStatus(warnings);

  upsertHistoricalValidationRun(database, {
    config,
    configHash: options.configHash,
    cubeRunId: options.cubeRunId,
    id: validationRunId,
    pipelineRunId: options.pipelineRunId,
    status
  });
  replaceHistoricalValidationRows(database, validationRunId, metrics, warnings);

  if (options.historicalValidationCsvPath) {
    writeHistoricalValidationCsv(
      options.historicalValidationCsvPath,
      listHistoricalValidationMetrics(database, validationRunId),
      listHistoricalValidationWarnings(database, validationRunId)
    );
    registerArtifact(database, options.pipelineRunId, options.historicalValidationCsvPath, "cube:validate:historical", options.configHash);
  }
  if (options.historicalPeriodCoverageCsvPath) {
    writePeriodCoverageCsv(options.historicalPeriodCoverageCsvPath, periodCoverage);
    registerArtifact(database, options.pipelineRunId, options.historicalPeriodCoverageCsvPath, "cube:validate:historical", options.configHash);
  }
  if (options.historicalArchetypeReconstructionCsvPath) {
    writeArchetypeReconstructionCsv(options.historicalArchetypeReconstructionCsvPath, reconstructionRows);
    registerArtifact(database, options.pipelineRunId, options.historicalArchetypeReconstructionCsvPath, "cube:validate:historical", options.configHash);
  }

  return {
    historicalArchetypeReconstructionCsvPath: options.historicalArchetypeReconstructionCsvPath,
    historicalPeriodCoverageCsvPath: options.historicalPeriodCoverageCsvPath,
    historicalValidationCsvPath: options.historicalValidationCsvPath,
    metrics: metrics.length,
    status,
    validationRunId,
    warnings: warnings.length
  };
}

type PeriodCoverageRow = {
  readonly periodId: string;
  readonly includedTargets: number;
  readonly totalTargets: number;
  readonly coverageShare: number;
};

function periodCoverageRows(
  periodIds: readonly string[],
  targets: readonly { readonly periodId: string; readonly cardName: string }[],
  cubeCards: ReadonlySet<string>
): readonly PeriodCoverageRow[] {
  return periodIds.map((periodId) => {
    const periodTargets = targets.filter((target) => target.periodId === periodId);
    const includedTargets = periodTargets.filter((target) => cubeCards.has(target.cardName)).length;
    return {
      coverageShare: periodTargets.length === 0 ? 0 : includedTargets / periodTargets.length,
      includedTargets,
      periodId,
      totalTargets: periodTargets.length
    };
  });
}

function validationMetrics(
  validationRunId: string,
  periodCoverage: readonly PeriodCoverageRow[],
  reconstructionRows: readonly CubeArchetypeReconstructionRow[],
  ecosystem: ReturnType<typeof getEcosystemDiversitySummary>,
  historicalScores: ReturnType<typeof listHistoricalCardScoreRows>,
  cubeCards: ReadonlySet<string>
): readonly HistoricalValidationMetricRow[] {
  const pillarCount = historicalScores.filter((score) => score.historicalRole === "format_pillar" && cubeCards.has(score.cardName)).length;
  const iconCount = historicalScores.filter((score) => score.historicalRole === "archetype_icon" && cubeCards.has(score.cardName)).length;
  const flashCount = historicalScores.filter((score) => score.historicalRole === "flash_in_the_pan" && cubeCards.has(score.cardName)).length;
  const representedPeriods = periodCoverage.filter((row) => row.includedTargets > 0).length;
  const averageReconstruction =
    reconstructionRows.reduce((total, row) => total + row.reconstructionScore, 0) / Math.max(1, reconstructionRows.length);
  return [
    metric(validationRunId, "periods.represented", "Represented set-release periods", representedPeriods),
    metric(validationRunId, "periods.total", "Total set-release periods", periodCoverage.length),
    metric(validationRunId, "historical.format_pillars", "Included format pillars", pillarCount),
    metric(validationRunId, "historical.archetype_icons", "Included archetype icons", iconCount),
    metric(validationRunId, "historical.flash_in_the_pan", "Included flashes in the pan", flashCount),
    metric(validationRunId, "reconstruction.average", "Average reconstruction score", averageReconstruction),
    metric(validationRunId, "ecosystem.archetypes", "Archetypes above threshold", ecosystem?.archetypesAboveThreshold ?? 0),
    metric(validationRunId, "ecosystem.periods", "Ecosystem periods represented", ecosystem?.periodsRepresented ?? 0),
    metric(validationRunId, "ecosystem.shared_efficiency", "Shared-card efficiency", ecosystem?.sharedCardEfficiency ?? 0)
  ];
}

function validationWarnings(
  validationRunId: string,
  cubeRunId: string,
  pipelineRunId: string,
  periodCoverage: readonly PeriodCoverageRow[],
  reconstructionRows: readonly CubeArchetypeReconstructionRow[],
  historicalScores: ReturnType<typeof listHistoricalCardScoreRows>,
  cubeCards: ReadonlySet<string>,
  ecosystem: ReturnType<typeof getEcosystemDiversitySummary>,
  config: HistoricalCubeValidationConfig
): readonly HistoricalValidationWarningRow[] {
  const warnings: HistoricalValidationWarningRow[] = [];
  for (const row of periodCoverage) {
    if (row.includedTargets < config.minimumPeriodCoverage) {
      warnings.push(warning(validationRunId, cubeRunId, pipelineRunId, "warn", "historical.period_under_supported", `${row.periodId} has only ${row.includedTargets} included historical targets.`, row));
    }
    if (row.includedTargets > config.maximumPeriodCoverage) {
      warnings.push(warning(validationRunId, cubeRunId, pipelineRunId, "warn", "historical.period_overrepresented", `${row.periodId} has ${row.includedTargets} included historical targets.`, row));
    }
  }

  for (const row of reconstructionRows.filter((entry) => entry.warnings.length > 0 || entry.reconstructionScore < config.minimumReconstructionScore)) {
    warnings.push(
      warning(
        validationRunId,
        cubeRunId,
        pipelineRunId,
        "warn",
        "historical.archetype_package_missing",
        `${row.archetypeFamily} in ${row.periodId} reconstruction score ${formatNumber(row.reconstructionScore)}.`,
        row
      )
    );
  }

  const missingIcons = historicalScores.filter((score) => score.historicalRole === "archetype_icon" && !cubeCards.has(score.cardName));
  for (const icon of missingIcons) {
    warnings.push(warning(validationRunId, cubeRunId, pipelineRunId, "warn", "historical.unsupported_era_icon", `${icon.cardName} is an archetype icon missing from the cube.`, icon));
  }

  const flashCount = historicalScores.filter((score) => score.historicalRole === "flash_in_the_pan" && cubeCards.has(score.cardName)).length;
  if (flashCount > config.maximumFlashInThePan) {
    warnings.push(warning(validationRunId, cubeRunId, pipelineRunId, "warn", "historical.flash_overrepresented", `${flashCount} flash-in-the-pan cards included.`, { flashCount, maximum: config.maximumFlashInThePan }));
  }

  if ((ecosystem?.sharedCardEfficiency ?? 0) < config.minimumEcosystemDiversityScore) {
    warnings.push(warning(validationRunId, cubeRunId, pipelineRunId, "warn", "historical.low_ecosystem_diversity", `Shared-card efficiency ${formatNumber(ecosystem?.sharedCardEfficiency ?? 0)} below minimum ${config.minimumEcosystemDiversityScore}.`, ecosystem ?? {}));
  }

  return warnings;
}

function metric(
  validationRunId: string,
  metricKey: string,
  label: string,
  value: number,
  metadata: unknown = {}
): HistoricalValidationMetricRow {
  return { label, metadata, metricKey, validationRunId, value };
}

function warning(
  validationRunId: string,
  cubeRunId: string,
  pipelineRunId: string,
  severity: "warn" | "fail",
  code: string,
  message: string,
  metadata: unknown
): HistoricalValidationWarningRow {
  return { code, cubeRunId, message, metadata, pipelineRunId, severity, validationRunId };
}

function validationStatus(warnings: readonly HistoricalValidationWarningRow[]): HistoricalValidationStatus {
  return warnings.some((warning) => warning.severity === "fail") ? "fail" : warnings.length > 0 ? "warn" : "pass";
}

function writeHistoricalValidationCsv(
  filePath: string,
  metrics: readonly HistoricalValidationMetricRow[],
  warnings: readonly HistoricalValidationWarningRow[]
): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "row_type,key,label_or_code,value_or_severity,message,metadata",
      ...metrics.map((row) => ["metric", row.metricKey, row.label, formatNumber(row.value), "", JSON.stringify(row.metadata ?? {})].map(csvEscape).join(",")),
      ...warnings.map((row) => ["warning", row.code, row.code, row.severity, row.message, JSON.stringify(row.metadata ?? {})].map(csvEscape).join(","))
    ].join("\n") + "\n"
  );
}

function writePeriodCoverageCsv(filePath: string, rows: readonly PeriodCoverageRow[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "period_id,included_targets,total_targets,coverage_share",
      ...rows.map((row) => [row.periodId, String(row.includedTargets), String(row.totalTargets), formatNumber(row.coverageShare)].map(csvEscape).join(","))
    ].join("\n") + "\n"
  );
}

function writeArchetypeReconstructionCsv(filePath: string, rows: readonly CubeArchetypeReconstructionRow[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "period_id,archetype_family,reconstruction_score,included_targets,total_targets,missing_core_cards,warnings",
      ...rows.map((row) => [row.periodId, row.archetypeFamily, formatNumber(row.reconstructionScore), String(row.includedTargets), String(row.totalTargets), row.missingCoreCards.join("|"), row.warnings.join("|")].map(csvEscape).join(","))
    ].join("\n") + "\n"
  );
}

function registerArtifact(database: DatabaseSync, pipelineRunId: string, filePath: string, stage: string, configHash?: string): void {
  registerOutputArtifact(database, {
    contentHash: createHash("sha256").update(readFileSync(filePath)).digest("hex"),
    format: path.extname(filePath).replace(/^\./, "") || "csv",
    path: filePath,
    pipelineRunId,
    sourceMetadata: { configHash, generatedBy: stage },
    stage
  });
}

function mergeConfig(options: Partial<HistoricalCubeValidationConfig>): HistoricalCubeValidationConfig {
  return {
    maximumFlashInThePan: options.maximumFlashInThePan ?? defaultConfig.maximumFlashInThePan,
    maximumPeriodCoverage: options.maximumPeriodCoverage ?? defaultConfig.maximumPeriodCoverage,
    minimumArchetypeIcons: options.minimumArchetypeIcons ?? defaultConfig.minimumArchetypeIcons,
    minimumEcosystemDiversityScore: options.minimumEcosystemDiversityScore ?? defaultConfig.minimumEcosystemDiversityScore,
    minimumFormatPillars: options.minimumFormatPillars ?? defaultConfig.minimumFormatPillars,
    minimumPeriodCoverage: options.minimumPeriodCoverage ?? defaultConfig.minimumPeriodCoverage,
    minimumReconstructionScore: options.minimumReconstructionScore ?? defaultConfig.minimumReconstructionScore
  };
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
