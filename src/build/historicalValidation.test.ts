import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyMigrations,
  listHistoricalValidationWarnings,
  listManualReviewItems,
  openDatabase,
  replaceArchetypeReconstructionTargets,
  replaceCubeArchetypeReconstructionRows,
  replaceCubeRunCards,
  replaceHistoricalCardScoreRows,
  replaceSetReleases,
  upsertCubeRun,
  upsertPipelineRun
} from "../db/index.js";
import { generateAndPersistMetagamePeriods } from "../periods.js";
import type { SetRelease } from "../types/contracts.js";
import { validateHistoricalCube } from "./historicalValidation.js";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("historical cube validation", () => {
  it("persists period coverage and archetype reconstruction warnings", () => {
    const outputDir = mkdtempSync(path.join(os.tmpdir(), "cube-refiner-historical-validation-"));
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    upsertPipelineRun(database, { configHash: "period-run", id: "period-run", status: "completed" });
    upsertCubeRun(database, {
      config: {},
      id: "cube-run",
      pipelineRunId: "period-run",
      totalCards: 1
    });
    replaceCubeRunCards(database, "cube-run", [
      {
        cardName: "Lightning Bolt",
        cubeRunId: "cube-run",
        position: 0,
        reason: "historical pillar",
        roles: ["glue"]
      }
    ]);
    replaceSetReleases(database, testReleases);
    generateAndPersistMetagamePeriods(database, {
      endDate: "2012-02-02",
      startDate: "2011-08-12"
    });
    replaceArchetypeReconstructionTargets(database, "period-run", [
      target("standard_set_release_m12_2011-08-12", "Burn", "Lightning Bolt"),
      target("standard_set_release_isd_2011-09-30", "Abzan", "Siege Rhino")
    ]);
    replaceCubeArchetypeReconstructionRows(
      database,
      "cube-run",
      "period-run",
      [
        {
          archetypeFamily: "Abzan",
          cubeRunId: "cube-run",
          includedImportance: 0,
          includedTargets: 0,
          missingCoreCards: ["Siege Rhino"],
          periodId: "standard_set_release_isd_2011-09-30",
          pipelineRunId: "period-run",
          reconstructionScore: 0,
          totalImportance: 1,
          totalTargets: 1,
          warnings: ["Missing core cards: Siege Rhino"]
        }
      ],
      {
        archetypesAboveThreshold: 0,
        cubeRunId: "cube-run",
        periodsRepresented: 1,
        pipelineRunId: "period-run",
        sharedCardEfficiency: 0,
        summary: {}
      }
    );
    replaceHistoricalCardScoreRows(database, "period-run", [
      historicalScore("Lightning Bolt", "format_pillar"),
      historicalScore("Siege Rhino", "archetype_icon")
    ]);

    const summary = validateHistoricalCube(database, {
      cubeRunId: "cube-run",
      historicalArchetypeReconstructionCsvPath: path.join(outputDir, "historical_archetype_reconstruction.csv"),
      historicalPeriodCoverageCsvPath: path.join(outputDir, "historical_period_coverage.csv"),
      historicalValidationCsvPath: path.join(outputDir, "historical_cube_validation_report.csv"),
      minimumPeriodCoverage: 1,
      pipelineRunId: "period-run",
      validationRunId: "historical-validation-test"
    });

    expect(summary.status).toBe("warn");
    expect(listHistoricalValidationWarnings(database, "historical-validation-test").map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["historical.period_under_supported", "historical.archetype_package_missing", "historical.unsupported_era_icon"])
    );
    expect(listManualReviewItems(database, "historical_validation")).not.toHaveLength(0);
    expect(readFileSync(summary.historicalValidationCsvPath ?? "", "utf8")).toContain("historical.unsupported_era_icon");
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

function target(periodId: string, archetypeFamily: string, cardName: string) {
  return {
    archetypeFamily,
    cardName,
    importance: 1,
    periodId,
    pipelineRunId: "period-run",
    targetRole: "core" as const
  };
}

function historicalScore(cardName: string, historicalRole: "format_pillar" | "archetype_icon") {
  return {
    archetypeImportanceScore: 1,
    cardName,
    config: {},
    eraScore: 1,
    explanation: `${cardName} ${historicalRole}`,
    glueScore: 0,
    historicalRole,
    longevityScore: 1,
    modernLegacyScore: 1,
    peakScore: 1,
    periodVariance: 0,
    pipelineRunId: "period-run"
  };
}
