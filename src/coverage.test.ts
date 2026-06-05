import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { generateHistoricalCoverageReport } from "./coverage.js";
import { applyMigrations, listManualReviewItems, listOutputArtifacts, openDatabase } from "./db/index.js";
import {
  listHistoricalCoverageWarnings,
  listHistoricalSourceCoverageRows,
  replaceSetReleases,
  upsertNormalizedDeck
} from "./db/repository.js";
import { generateAndPersistMetagamePeriods } from "./periods.js";
import type { SetRelease } from "./types/contracts.js";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("historical source coverage", () => {
  it("aggregates coverage by period, source, year rollup, and archetype family", () => {
    const outputDir = mkdtempSync(path.join(os.tmpdir(), "cube-refiner-coverage-"));
    const manifestPath = path.join(outputDir, "source-manifest.json");
    const outputCsvPath = path.join(outputDir, "historical_source_coverage.csv");
    writeFileSync(
      manifestPath,
      JSON.stringify(
        [
          {
            endDate: "2012-02-02",
            source: "mtgtop8",
            startDate: "2011-08-12",
            status: "available"
          },
          {
            endDate: "2012-02-02",
            source: "mtgo",
            startDate: "2011-08-12",
            status: "unknown"
          }
        ],
        null,
        2
      )
    );

    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    replaceSetReleases(database, testReleases);
    generateAndPersistMetagamePeriods(database, {
      endDate: "2012-02-02",
      startDate: "2011-08-12"
    });
    upsertTestDeck(database, "jund-1", "2011-08-12", "mtgtop8", "BGx Midrange");

    const summary = generateHistoricalCoverageReport(database, {
      minimumDecksPerPeriod: 2,
      outputCsvPath,
      pipelineRunId: "coverage-test",
      sourceManifestPath: manifestPath
    });

    expect(summary).toEqual({
      assignedDecks: 1,
      assignmentReviewRows: 0,
      outputCsvPath,
      pipelineRunId: "coverage-test",
      rows: 5,
      warnings: 4
    });
    expect(
      listHistoricalSourceCoverageRows(database, "coverage-test").map((row) => ({
        archetypeFamily: row.archetypeFamily,
        coverageStatus: row.coverageStatus,
        deckCount: row.deckCount,
        periodId: row.periodId,
        source: row.source,
        sourceStatus: row.sourceStatus,
        warningCodes: row.warningCodes,
        year: row.year
      }))
    ).toEqual([
      {
        archetypeFamily: "(all)",
        coverageStatus: "observed_play",
        deckCount: 1,
        periodId: "standard_set_release_m12_2011-08-12",
        source: "mtgtop8",
        sourceStatus: "available",
        warningCodes: ["thin_period"],
        year: 2011
      },
      {
        archetypeFamily: "BGx Midrange",
        coverageStatus: "observed_play",
        deckCount: 1,
        periodId: "standard_set_release_m12_2011-08-12",
        source: "mtgtop8",
        sourceStatus: "available",
        warningCodes: ["thin_period"],
        year: 2011
      },
      {
        archetypeFamily: "(all)",
        coverageStatus: "missing_source_coverage",
        deckCount: 0,
        periodId: "standard_set_release_m12_2011-08-12",
        source: "mtgo",
        sourceStatus: "unknown",
        warningCodes: ["thin_period", "missing_source_coverage"],
        year: 2011
      },
      {
        archetypeFamily: "(all)",
        coverageStatus: "no_observed_play",
        deckCount: 0,
        periodId: "standard_set_release_isd_2011-09-30",
        source: "mtgtop8",
        sourceStatus: "available",
        warningCodes: ["empty_period"],
        year: 2011
      },
      {
        archetypeFamily: "(all)",
        coverageStatus: "missing_source_coverage",
        deckCount: 0,
        periodId: "standard_set_release_isd_2011-09-30",
        source: "mtgo",
        sourceStatus: "unknown",
        warningCodes: ["empty_period", "missing_source_coverage"],
        year: 2011
      }
    ]);
    expect(listHistoricalCoverageWarnings(database, "coverage-test").map((warning) => warning.warningType)).toEqual([
      "thin_period",
      "missing_source_coverage",
      "empty_period",
      "missing_source_coverage"
    ]);
    expect(listManualReviewItems(database, "historical_coverage")).toHaveLength(4);
    expect(listOutputArtifacts(database, "coverage-test")).toHaveLength(1);
    expect(readFileSync(outputCsvPath, "utf8")).toContain("pipeline_run_id,period_id");
    expect(readFileSync(outputCsvPath, "utf8")).toContain("missing_source_coverage");
  });
});

const testReleases: readonly SetRelease[] = [
  {
    releaseDate: "2011-07-15",
    setCode: "m12",
    setName: "Magic 2012",
    setType: "core",
    source: "test"
  },
  {
    releaseDate: "2011-09-30",
    setCode: "isd",
    setName: "Innistrad",
    setType: "expansion",
    source: "test"
  },
  {
    releaseDate: "2012-02-03",
    setCode: "dka",
    setName: "Dark Ascension",
    setType: "expansion",
    source: "test"
  }
];

function upsertTestDeck(
  database: DatabaseSync,
  deckId: string,
  eventDate: string,
  source: "mtgtop8" | "mtgo",
  archetypeFamily: string
): void {
  upsertNormalizedDeck(database, {
    archetype: "Jund",
    archetypeFamily,
    deckId,
    eventDate,
    fingerprint: `fingerprint-${deckId}`,
    mainboard: [{ copies: 4, name: "Lightning Bolt" }],
    sideboard: [],
    source,
    sourceUrl: `https://example.test/${deckId}`,
    weight: 1,
    year: Number(eventDate.slice(0, 4))
  });
}
