import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyMigrations,
  openDatabase,
  replaceCardArchetypeMatrixRows,
  replaceCardScoreRows,
  upsertCard,
  upsertPipelineRun
} from "../db/index.js";
import { classifyCandidatePools, generateCandidatePools } from "./candidates.js";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("candidate pools", () => {
  it("classifies cards into explainable candidate pools", () => {
    const rows = classifyCandidatePools({
      card: {
        canonicalName: "Lightning Bolt",
        colorIdentity: ["R"],
        colors: ["R"],
        manaValue: 1,
        typeLine: "Instant"
      },
      score: {
        cardName: "Lightning Bolt",
        cubeScore: 0.9,
        exclusivityScore: 0.2,
        frequency: 10,
        glueScore: 3,
        highestAffinity: 0.7,
        parasiticScore: 0,
        pipelineRunId: "run",
        secondHighestAffinity: 0.5,
        signpostScore: 0.2,
        weightedGlueScore: 4
      },
      sideboardShare: 0.1,
      topArchetypes: ["Burn:0.7"]
    });

    expect(rows.map((row) => row.pool)).toEqual(["auto_includes", "glue_cards", "removal"]);
    expect(rows[0]?.roles).toEqual(["glue", "curve", "support"]);
    expect(rows[0]?.explanation).toContain("top=Burn:0.7");
  });

  it("persists candidate rows and exports all pool CSVs", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    upsertPipelineRun(database, {
      configHash: "scores",
      id: "candidate-test-run",
      status: "completed"
    });
    seedCards(database);
    replaceCardScoreRows(database, "candidate-test-run", [
      scoreRow("Lightning Bolt", { cubeScore: 0.9, glueScore: 3, signpostScore: 0.2, weightedGlueScore: 4 }),
      scoreRow("Splinter Twin", { cubeScore: 0.5, glueScore: 1, parasiticScore: 0.4, signpostScore: 1.2 }),
      scoreRow("Steam Vents", { cubeScore: 0.7, glueScore: 2, weightedGlueScore: 2 }),
      scoreRow("Rest in Peace", { cubeScore: 0.25, glueScore: 0, parasiticScore: 0.1, signpostScore: 0.1 }),
      scoreRow("Tarmogoyf", { cubeScore: 0.65, glueScore: 1, weightedGlueScore: 1 })
    ]);
    replaceCardArchetypeMatrixRows(database, "candidate-test-run", [
      matrixRow("Lightning Bolt", "Burn", 0.7, 8, 0),
      matrixRow("Splinter Twin", "Twin", 0.8, 4, 0),
      matrixRow("Steam Vents", "Twin", 0.5, 2, 0),
      matrixRow("Rest in Peace", "Sideboard", 0.2, 0, 3),
      matrixRow("Tarmogoyf", "BGx Midrange", 0.4, 4, 0)
    ]);
    const outputDir = mkdtempSync(path.join(os.tmpdir(), "cube-refiner-candidates-"));

    const summary = generateCandidatePools(database, {
      outputDir,
      pipelineRunId: "candidate-test-run",
      signpostMinScore: 1
    });

    expect(summary.persistedRows).toBeGreaterThanOrEqual(10);
    expect(
      database
        .prepare(
          `SELECT card_name AS cardName, pool, roles_json AS rolesJson
           FROM candidate_pool_cards
           WHERE pipeline_run_id = ?
           ORDER BY pool, card_name`
        )
        .all("candidate-test-run")
    ).toEqual(
      expect.arrayContaining([
        { cardName: "Lightning Bolt", pool: "auto_includes", rolesJson: expect.any(String) },
        { cardName: "Lightning Bolt", pool: "glue_cards", rolesJson: expect.any(String) },
        { cardName: "Lightning Bolt", pool: "removal", rolesJson: expect.any(String) },
        { cardName: "Splinter Twin", pool: "signpost_cards", rolesJson: expect.any(String) },
        { cardName: "Rest in Peace", pool: "sideboard_cards", rolesJson: expect.any(String) },
        { cardName: "Steam Vents", pool: "lands", rolesJson: expect.any(String) },
        { cardName: "Tarmogoyf", pool: "threats", rolesJson: expect.any(String) }
      ])
    );
    expect(Object.values(summary.exportedCsvPaths)).toHaveLength(8);
    expect(readFileSync(path.join(outputDir, "auto_includes.csv"), "utf8")).toContain("Lightning Bolt");
    expect(readFileSync(path.join(outputDir, "signpost_cards.csv"), "utf8")).toContain("Splinter Twin");
    expect(readFileSync(path.join(outputDir, "sideboard_cards.csv"), "utf8")).toContain("Rest in Peace");
    expect(readFileSync(path.join(outputDir, "lands.csv"), "utf8")).toContain("Steam Vents");
  });
});

function seedCards(database: DatabaseSync): void {
  upsertCard(database, { canonicalName: "Lightning Bolt", colors: ["R"], manaValue: 1, typeLine: "Instant" });
  upsertCard(database, { canonicalName: "Splinter Twin", colors: ["R"], manaValue: 4, typeLine: "Enchantment" });
  upsertCard(database, { canonicalName: "Steam Vents", colorIdentity: ["U", "R"], manaValue: 0, typeLine: "Land" });
  upsertCard(database, { canonicalName: "Rest in Peace", colors: ["W"], manaValue: 2, typeLine: "Enchantment" });
  upsertCard(database, { canonicalName: "Tarmogoyf", colors: ["G"], manaValue: 2, typeLine: "Creature" });
}

function scoreRow(
  cardName: string,
  overrides: Partial<{
    readonly cubeScore: number;
    readonly frequency: number;
    readonly glueScore: number;
    readonly parasiticScore: number;
    readonly signpostScore: number;
    readonly weightedGlueScore: number;
  }>
) {
  return {
    cardName,
    cubeScore: overrides.cubeScore ?? 0,
    exclusivityScore: 0.5,
    frequency: overrides.frequency ?? 8,
    glueScore: overrides.glueScore ?? 0,
    highestAffinity: 0.8,
    parasiticScore: overrides.parasiticScore ?? 0,
    pipelineRunId: "candidate-test-run",
    secondHighestAffinity: 0.3,
    signpostScore: overrides.signpostScore ?? 0,
    weightedGlueScore: overrides.weightedGlueScore ?? 0
  };
}

function matrixRow(
  cardName: string,
  archetypeFamily: string,
  affinity: number,
  mainboardCopies: number,
  sideboardCopies: number
) {
  return {
    affinity,
    archetypeFamily,
    cardName,
    decksWithCard: affinity * 10,
    mainboardCopies,
    pipelineRunId: "candidate-test-run",
    sideboardCopies,
    totalDecksInArchetype: 10
  };
}
