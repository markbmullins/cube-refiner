import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { defaultProjectPaths } from "./config/paths.js";
import {
  createPipelineRunId,
  listHistoricalCoverageInputRows,
  listMetagamePeriods,
  registerOutputArtifact,
  replaceHistoricalSourceCoverageRows,
  upsertPipelineRun
} from "./db/index.js";
import { assignDecksToMetagamePeriods } from "./periods.js";
import type {
  DeckSource,
  HistoricalCoverageInterpretation,
  HistoricalCoverageWarning,
  HistoricalCoverageWarningType,
  HistoricalSourceCoverageRow,
  HistoricalSourceCoverageStatus,
  MetaPeriod,
  SourceCoverageManifestEntry
} from "./types/contracts.js";

export const defaultSourceCoverageManifestPath = path.join(process.cwd(), "data", "source-coverage-manifest.json");
export const defaultHistoricalCoverageCsvPath = path.join(defaultProjectPaths.outputsDir, "historical_source_coverage.csv");
export const defaultMinimumDecksPerPeriod = 8;

export type HistoricalCoverageReportOptions = {
  readonly outputCsvPath?: string;
  readonly sourceManifestPath?: string;
  readonly minimumDecksPerPeriod?: number;
  readonly pipelineRunId?: string;
};

export type HistoricalCoverageReportSummary = {
  readonly pipelineRunId: string;
  readonly outputCsvPath?: string;
  readonly rows: number;
  readonly warnings: number;
  readonly assignedDecks: number;
  readonly assignmentReviewRows: number;
};

type SourcePeriodCount = {
  readonly source: DeckSource;
  readonly periodId: string;
  readonly archetypeFamily: string;
  readonly deckCount: number;
};

export function loadSourceCoverageManifest(
  filePath: string = defaultSourceCoverageManifestPath
): readonly SourceCoverageManifestEntry[] {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Source coverage manifest must be a JSON array: ${filePath}`);
  }

  return parsed.map((entry) => normalizeManifestEntry(entry));
}

export function generateHistoricalCoverageReport(
  database: DatabaseSync,
  options: HistoricalCoverageReportOptions = {}
): HistoricalCoverageReportSummary {
  const pipelineRunId = options.pipelineRunId ?? createPipelineRunId();
  const minimumDecksPerPeriod = options.minimumDecksPerPeriod ?? defaultMinimumDecksPerPeriod;
  const outputCsvPath = options.outputCsvPath ?? defaultHistoricalCoverageCsvPath;
  const manifest = loadSourceCoverageManifest(options.sourceManifestPath);
  const assignmentSummary = assignDecksToMetagamePeriods(database);
  const periods = listMetagamePeriods(database);
  const coverageInputRows = listHistoricalCoverageInputRows(database);
  const sources = sourceUniverse(manifest, coverageInputRows.map((row) => row.source));
  const counts = countBySourcePeriodFamily(coverageInputRows);

  const rows: HistoricalSourceCoverageRow[] = [];
  const warnings: HistoricalCoverageWarning[] = [];
  for (const period of periods) {
    const totalDecks = totalDecksForPeriod(counts, period.periodId);
    const periodWarningCodes: HistoricalCoverageWarningType[] = [];
    if (totalDecks === 0) {
      periodWarningCodes.push("empty_period");
      warnings.push({
        message: `No decklists assigned to ${period.setName} (${period.startDate} to ${period.endDate}).`,
        metadata: { deckCount: totalDecks, minimumDecksPerPeriod },
        periodId: period.periodId,
        pipelineRunId,
        severity: "fail",
        warningType: "empty_period"
      });
    } else if (totalDecks < minimumDecksPerPeriod) {
      periodWarningCodes.push("thin_period");
      warnings.push({
        message: `${period.setName} has ${totalDecks} decklists, below the ${minimumDecksPerPeriod} minimum.`,
        metadata: { deckCount: totalDecks, minimumDecksPerPeriod },
        periodId: period.periodId,
        pipelineRunId,
        severity: "warn",
        warningType: "thin_period"
      });
    }

    for (const source of sources) {
      const sourceTotal = deckCountFor(counts, period.periodId, source, "(all)");
      const sourceStatus = sourceStatusFor(manifest, source, period);
      const coverageStatus = interpretCoverage(sourceTotal, sourceStatus);
      const sourceWarningCodes: HistoricalCoverageWarningType[] = [...periodWarningCodes];
      if (sourceTotal === 0 && sourceStatus !== "available") {
        sourceWarningCodes.push("missing_source_coverage");
        warnings.push({
          message: `${source} coverage is ${sourceStatus} for ${period.setName}; zero decklists should be reviewed as missing coverage.`,
          metadata: {
            sourceStatus,
            periodStartDate: period.startDate,
            periodEndDate: period.endDate
          },
          periodId: period.periodId,
          pipelineRunId,
          severity: "warn",
          source,
          warningType: "missing_source_coverage"
        });
      }

      rows.push(coverageRow(pipelineRunId, period, source, "(all)", sourceTotal, sourceStatus, coverageStatus, sourceWarningCodes));
      for (const family of familiesFor(counts, period.periodId, source)) {
        rows.push(
          coverageRow(
            pipelineRunId,
            period,
            source,
            family,
            deckCountFor(counts, period.periodId, source, family),
            sourceStatus,
            "observed_play",
            periodWarningCodes
          )
        );
      }
    }
  }

  upsertPipelineRun(database, {
    completedAt: new Date().toISOString(),
    configHash: stableConfigHash({
      minimumDecksPerPeriod,
      sourceManifestPath: options.sourceManifestPath ?? defaultSourceCoverageManifestPath
    }),
    id: pipelineRunId,
    status: "completed"
  });
  replaceHistoricalSourceCoverageRows(database, pipelineRunId, rows, warnings);
  writeCoverageCsv(outputCsvPath, rows);
  registerCoverageArtifact(database, pipelineRunId, outputCsvPath);

  return {
    assignedDecks: assignmentSummary.assignedDecks,
    assignmentReviewRows: assignmentSummary.reviewRows,
    outputCsvPath,
    pipelineRunId,
    rows: rows.length,
    warnings: warnings.length
  };
}

function countBySourcePeriodFamily(rows: readonly ReturnType<typeof listHistoricalCoverageInputRows>[number][]): readonly SourcePeriodCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    incrementCount(counts, row.periodId, row.source, "(all)");
    incrementCount(counts, row.periodId, row.source, row.archetypeFamily);
  }

  return [...counts.entries()].map(([key, deckCount]) => {
    const [periodId = "", source = "mtgtop8", archetypeFamily = ""] = key.split("\0");
    return {
      archetypeFamily,
      deckCount,
      periodId,
      source: source as DeckSource
    };
  });
}

function incrementCount(
  counts: Map<string, number>,
  periodId: string,
  source: DeckSource,
  archetypeFamily: string
): void {
  const key = coverageKey(periodId, source, archetypeFamily);
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function totalDecksForPeriod(counts: readonly SourcePeriodCount[], periodId: string): number {
  return counts
    .filter((count) => count.periodId === periodId && count.archetypeFamily === "(all)")
    .reduce((total, count) => total + count.deckCount, 0);
}

function deckCountFor(
  counts: readonly SourcePeriodCount[],
  periodId: string,
  source: DeckSource,
  archetypeFamily: string
): number {
  return counts.find((count) => count.periodId === periodId && count.source === source && count.archetypeFamily === archetypeFamily)?.deckCount ?? 0;
}

function familiesFor(counts: readonly SourcePeriodCount[], periodId: string, source: DeckSource): readonly string[] {
  return counts
    .filter((count) => count.periodId === periodId && count.source === source && count.archetypeFamily !== "(all)")
    .map((count) => count.archetypeFamily)
    .sort((left, right) => left.localeCompare(right));
}

function sourceUniverse(
  manifest: readonly SourceCoverageManifestEntry[],
  observedSources: readonly DeckSource[]
): readonly DeckSource[] {
  const orderedSources: DeckSource[] = [];
  for (const source of [
    ...manifest.map((entry) => entry.source),
    ...[...observedSources].sort((left, right) => left.localeCompare(right))
  ]) {
    if (!orderedSources.includes(source)) {
      orderedSources.push(source);
    }
  }

  return orderedSources;
}

function sourceStatusFor(
  manifest: readonly SourceCoverageManifestEntry[],
  source: DeckSource,
  period: MetaPeriod
): HistoricalSourceCoverageStatus {
  const entry = manifest.find(
    (candidate) =>
      candidate.source === source &&
      candidate.startDate.localeCompare(period.endDate) <= 0 &&
      period.startDate.localeCompare(candidate.endDate) <= 0
  );
  return entry?.status ?? "unknown";
}

function interpretCoverage(
  deckCount: number,
  sourceStatus: HistoricalSourceCoverageStatus
): HistoricalCoverageInterpretation {
  if (deckCount > 0) {
    return "observed_play";
  }

  return sourceStatus === "available" ? "no_observed_play" : "missing_source_coverage";
}

function coverageRow(
  pipelineRunId: string,
  period: MetaPeriod,
  source: DeckSource,
  archetypeFamily: string,
  deckCount: number,
  sourceStatus: HistoricalSourceCoverageStatus,
  coverageStatus: HistoricalCoverageInterpretation,
  warningCodes: readonly HistoricalCoverageWarningType[]
): HistoricalSourceCoverageRow {
  return {
    archetypeFamily,
    coverageStatus,
    deckCount,
    periodEndDate: period.endDate,
    periodId: period.periodId,
    periodStartDate: period.startDate,
    pipelineRunId,
    setCode: period.setCode,
    setName: period.setName,
    source,
    sourceStatus,
    warningCodes: [...new Set(warningCodes)],
    year: Number(period.startDate.slice(0, 4))
  };
}

function writeCoverageCsv(filePath: string, rows: readonly HistoricalSourceCoverageRow[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "pipeline_run_id,period_id,set_code,set_name,period_start_date,period_end_date,year,source,archetype_family,deck_count,source_status,coverage_status,warning_codes",
      ...rows.map((row) =>
        [
          row.pipelineRunId,
          row.periodId,
          row.setCode,
          row.setName,
          row.periodStartDate,
          row.periodEndDate,
          String(row.year),
          row.source,
          row.archetypeFamily,
          String(row.deckCount),
          row.sourceStatus,
          row.coverageStatus,
          row.warningCodes.join("|")
        ].map(csvEscape).join(",")
      )
    ].join("\n") + "\n"
  );
}

function registerCoverageArtifact(database: DatabaseSync, pipelineRunId: string, filePath: string): void {
  registerOutputArtifact(database, {
    contentHash: createHash("sha256").update(readFileSync(filePath)).digest("hex"),
    format: "csv",
    path: filePath,
    pipelineRunId,
    sourceMetadata: { generatedBy: "coverage:historical" },
    stage: "coverage:historical"
  });
}

function normalizeManifestEntry(value: unknown): SourceCoverageManifestEntry {
  if (value === null || typeof value !== "object") {
    throw new Error("Source coverage manifest entries must be objects.");
  }

  const record = value as Record<string, unknown>;
  const source = readRequiredString(record, "source");
  const startDate = readRequiredString(record, "startDate");
  const endDate = readRequiredString(record, "endDate");
  const status = readRequiredString(record, "status");
  if (!isDeckSource(source)) {
    throw new Error(`Unknown coverage source: ${source}`);
  }
  if (!isSourceStatus(status)) {
    throw new Error(`Unknown coverage source status: ${status}`);
  }

  return {
    endDate,
    notes: typeof record.notes === "string" ? record.notes : undefined,
    source,
    startDate,
    status
  };
}

function isDeckSource(value: string): value is DeckSource {
  return value === "mtgtop8" || value === "mtggoldfish" || value === "mtgo";
}

function isSourceStatus(value: string): value is HistoricalSourceCoverageStatus {
  return value === "available" || value === "unavailable" || value === "unknown";
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Source coverage manifest entry missing string field: ${key}`);
  }

  return value;
}

function coverageKey(periodId: string, source: DeckSource, archetypeFamily: string): string {
  return `${periodId}\0${source}\0${archetypeFamily}`;
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
