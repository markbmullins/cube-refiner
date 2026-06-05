import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigrations, openDatabase, upsertCard, upsertRawDeck } from "./db/index.js";
import { runFullPipeline } from "./pipeline.js";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("full pipeline", () => {
  it("runs DB-first stages, writes exports, and records lineage artifacts", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cube-refiner-pipeline-"));
    const databasePath = path.join(dir, "pipeline.sqlite");
    const outputDir = path.join(dir, "outputs");
    database = openDatabase({ path: databasePath });
    applyMigrations(database);
    seedCards(database);
    seedRawDecks(database);
    database.close();
    database = undefined;

    const summary = await runFullPipeline({
      databasePath,
      outputDir,
      pipelineRunId: "pipeline-test",
      skipCollect: true,
      totalCards: 4,
      validationRunId: "validation-test"
    });

    expect(summary.pipelineRunId).toBe("pipeline-test");
    expect(summary.validationRunId).toBe("validation-test");
    expect(summary.artifactPaths).toContain(path.join(outputDir, "cube_360_candidate.csv"));
    expect(summary.artifactPaths).toContain(path.join(outputDir, "cube_validation_report.csv"));
    expect(summary.artifactPaths).toContain(path.join(outputDir, "cube_cobra_import.txt"));
    expect(existsSync(path.join(outputDir, "cards_ranked.csv"))).toBe(true);
    expect(readFileSync(path.join(outputDir, "cube_cobra_import.txt"), "utf8")).toContain("1 Lightning Bolt");

    database = openDatabase({ path: databasePath });
    const pipelineRow = database.prepare("SELECT status FROM pipeline_runs WHERE id = ?").get("pipeline-test");
    const stageCount = database
      .prepare("SELECT COUNT(*) AS count FROM pipeline_stage_runs WHERE pipeline_run_id = ? AND status = 'completed'")
      .get("pipeline-test");
    const artifactCount = database.prepare("SELECT COUNT(*) AS count FROM output_artifacts WHERE pipeline_run_id = ?").get("pipeline-test");
    const configProfile = database.prepare("SELECT config_hash AS configHash FROM config_profiles WHERE name = ?").get("pipeline:latest");
    const cubeRow = database.prepare("SELECT total_cards AS totalCards FROM cube_runs WHERE id = ?").get(summary.cubeRunId);

    expect(pipelineRow).toEqual({ status: "completed" });
    expect(Number(stageCount?.count)).toBeGreaterThanOrEqual(8);
    expect(Number(artifactCount?.count)).toBeGreaterThanOrEqual(8);
    expect(configProfile).toEqual({ configHash: expect.any(String) });
    expect(cubeRow).toEqual({ totalCards: 4 });
  });
});

function seedCards(database: DatabaseSync): void {
  for (const card of [
    { canonicalName: "Lightning Bolt", colors: ["R"], colorIdentity: ["R"], manaValue: 1, typeLine: "Instant" },
    { canonicalName: "Tarmogoyf", colors: ["G"], colorIdentity: ["G"], manaValue: 2, typeLine: "Creature" },
    { canonicalName: "Splinter Twin", colors: ["R"], colorIdentity: ["R"], manaValue: 4, typeLine: "Enchantment" },
    { canonicalName: "Deceiver Exarch", colors: ["U"], colorIdentity: ["U"], manaValue: 3, typeLine: "Creature" }
  ]) {
    upsertCard(database, card);
  }
}

function seedRawDecks(database: DatabaseSync): void {
  upsertRawDeck(database, {
    eventDate: "2015-01-01",
    format: "Modern",
    mainboard: [
      { copies: 4, name: "Lightning Bolt" },
      { copies: 4, name: "Tarmogoyf" }
    ],
    reportedArchetype: "Jund",
    sideboard: [],
    source: "mtgtop8",
    sourceUrl: "https://example.test/jund"
  });
  upsertRawDeck(database, {
    eventDate: "2015-01-02",
    format: "Modern",
    mainboard: [
      { copies: 4, name: "Lightning Bolt" },
      { copies: 4, name: "Splinter Twin" },
      { copies: 4, name: "Deceiver Exarch" }
    ],
    reportedArchetype: "Splinter Twin",
    sideboard: [],
    source: "mtgo",
    sourceUrl: "https://example.test/twin"
  });
}
