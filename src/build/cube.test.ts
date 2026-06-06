import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyMigrations,
  openDatabase,
  replaceCandidatePoolCards,
  upsertCard,
  upsertPipelineRun
} from "../db/index.js";
import { buildCubeCandidates, generateCube, selectCubeCards, selectHistoricalCubeCards } from "./cube.js";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("cube generator", () => {
  it("selects by constrained priority instead of pure score order", () => {
    const candidates = buildCubeCandidates(
      [
        candidate("Steam Vents", "lands", 0.4, ["fixing"]),
        candidate("Lightning Bolt", "glue_cards", 0.9, ["glue", "curve"]),
        candidate("Splinter Twin", "signpost_cards", 0.8, ["signpost", "support"]),
        candidate("Tarmogoyf", "threats", 0.7, ["role"])
      ],
      [
        card("Steam Vents", "Land", 0, [], ["U", "R"]),
        card("Lightning Bolt", "Instant", 1, ["R"]),
        card("Splinter Twin", "Enchantment", 4, ["R"]),
        card("Tarmogoyf", "Creature", 2, ["G"])
      ]
    );

    const selected = selectCubeCards(candidates, {
      counterspellNamePatterns: [],
      minimumArchetypeIcons: 0,
      minimumCounterspells: 0,
      minimumFormatPillars: 0,
      minimumRepresentedPeriods: 0,
      minimumRemoval: 0,
      minimumSweepers: 0,
      mode: "aggregate",
      sweeperNamePatterns: [],
      targets: {
        Black: 0,
        Blue: 0,
        Colorless: 0,
        Gold: 1,
        Green: 1,
        Lands: 1,
        Red: 2,
        White: 0
      },
      totalCards: 4
    });

    expect(selected.map((row) => row.cardName)).toEqual([
      "Steam Vents",
      "Lightning Bolt",
      "Splinter Twin",
      "Tarmogoyf"
    ]);
    expect(selected[0]?.explanation).toContain("fixing:");
  });

  it("historical mode includes an era icon that greatest-hits ordering would miss", () => {
    const candidates = buildCubeCandidates(
      [
        candidate("Generic Staple", "threats", 0.99, ["role"]),
        candidate("Lightning Bolt", "glue_cards", 0.7, ["glue"]),
        candidate("Siege Rhino", "signpost_cards", 0.2, ["signpost"])
      ],
      [
        card("Generic Staple", "Creature", 2, ["G"]),
        card("Lightning Bolt", "Instant", 1, ["R"]),
        card("Siege Rhino", "Creature", 4, ["W", "B", "G"])
      ],
      [
        historicalScore("Lightning Bolt", "format_pillar", 0.9),
        historicalScore("Siege Rhino", "archetype_icon", 0.8),
        historicalScore("Generic Staple", "role_player", 0.1)
      ],
      [
        reconstructionTarget("Siege Rhino", "p-khans", "Abzan", "core"),
        reconstructionTarget("Lightning Bolt", "p-modern", "Burn", "glue")
      ]
    );

    const selected = selectHistoricalCubeCards(candidates, {
      counterspellNamePatterns: [],
      minimumArchetypeIcons: 1,
      minimumCounterspells: 0,
      minimumFormatPillars: 1,
      minimumRepresentedPeriods: 1,
      minimumRemoval: 0,
      minimumSweepers: 0,
      mode: "historical",
      sweeperNamePatterns: [],
      targets: {
        Black: 0,
        Blue: 0,
        Colorless: 0,
        Gold: 1,
        Green: 1,
        Lands: 0,
        Red: 1,
        White: 0
      },
      totalCards: 2
    });

    expect(selected.map((row) => row.cardName)).toContain("Siege Rhino");
    expect(selected.find((row) => row.cardName === "Siege Rhino")?.explanation).toContain("historical archetype icon");
  });

  it("persists a cube run and exports cube_360_candidate CSV", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    upsertPipelineRun(database, {
      configHash: "candidate-pools",
      id: "cube-test-run",
      status: "completed"
    });
    seedCards(database);
    replaceCandidatePoolCards(database, "cube-test-run", [
      candidate("Steam Vents", "lands", 0.4, ["fixing"]),
      candidate("Lightning Bolt", "glue_cards", 0.9, ["glue", "curve"]),
      candidate("Splinter Twin", "signpost_cards", 0.8, ["signpost", "support"]),
      candidate("Tarmogoyf", "threats", 0.7, ["role"])
    ]);
    const outputCsvPath = path.join(mkdtempSync(path.join(os.tmpdir(), "cube-refiner-cube-")), "cube_360_candidate.csv");

    const summary = generateCube(database, {
      configHash: "cube-config-hash",
      cubeRunId: "cube-test",
      outputCsvPath,
      pipelineRunId: "cube-test-run",
      targets: {
        Black: 0,
        Blue: 0,
        Colorless: 0,
        Gold: 1,
        Green: 1,
        Lands: 1,
        Red: 2,
        White: 0
      },
      totalCards: 4
    });

    expect(summary).toEqual({
      cubeRunId: "cube-test",
      outputCsvPath,
      selectedCards: 4
    });
    expect(
      database
        .prepare(
          `SELECT card_name AS cardName, position, reason
           FROM cube_run_cards
           WHERE cube_run_id = ?
           ORDER BY position`
        )
        .all("cube-test")
    ).toEqual([
      { cardName: "Steam Vents", position: 0, reason: expect.stringContaining("fixing") },
      { cardName: "Lightning Bolt", position: 1, reason: expect.stringContaining("glue") },
      { cardName: "Splinter Twin", position: 2, reason: expect.stringContaining("signpost") },
      { cardName: "Tarmogoyf", position: 3, reason: expect.stringContaining("role filler") }
    ]);
    expect(database.prepare("SELECT config_hash AS configHash, total_cards AS totalCards FROM cube_runs WHERE id = ?").get("cube-test")).toEqual({
      configHash: "cube-config-hash",
      totalCards: 4
    });
    expect(readFileSync(outputCsvPath, "utf8")).toContain("Lightning Bolt");
  });
});

function seedCards(database: DatabaseSync): void {
  for (const entry of [
    card("Steam Vents", "Land", 0, [], ["U", "R"]),
    card("Lightning Bolt", "Instant", 1, ["R"]),
    card("Splinter Twin", "Enchantment", 4, ["R"]),
    card("Tarmogoyf", "Creature", 2, ["G"])
  ]) {
    upsertCard(database, {
      canonicalName: entry.canonicalName,
      colorIdentity: entry.colorIdentity,
      colors: entry.colors,
      manaValue: entry.manaValue,
      typeLine: entry.typeLine
    });
  }
}

function candidate(
  cardName: string,
  pool: "lands" | "glue_cards" | "signpost_cards" | "threats",
  score: number,
  roles: readonly ("glue" | "signpost" | "fixing" | "support" | "curve" | "role")[]
) {
  return {
    cardName,
    explanation: `${pool} candidate`,
    pipelineRunId: "cube-test-run",
    pool,
    roles,
    score
  };
}

function card(
  canonicalName: string,
  typeLine: string,
  manaValue: number,
  colors: readonly string[],
  colorIdentity: readonly string[] = colors
) {
  return {
    canonicalName,
    colorIdentity,
    colors,
    manaValue,
    typeLine
  };
}

function historicalScore(cardName: string, historicalRole: "format_pillar" | "archetype_icon" | "role_player", score: number) {
  return {
    archetypeImportanceScore: 1,
    cardName,
    config: {},
    eraScore: 1,
    explanation: `${cardName} historical`,
    glueScore: 0,
    historicalRole,
    longevityScore: score,
    modernLegacyScore: score,
    peakScore: score,
    periodVariance: 0,
    pipelineRunId: "cube-test-run"
  };
}

function reconstructionTarget(
  cardName: string,
  periodId: string,
  archetypeFamily: string,
  targetRole: "core" | "glue"
) {
  return {
    archetypeFamily,
    cardName,
    importance: 1,
    periodId,
    pipelineRunId: "cube-test-run",
    targetRole
  };
}
