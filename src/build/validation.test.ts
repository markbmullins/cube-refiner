import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyMigrations,
  listValidationMetrics,
  listValidationWarnings,
  listValidationZeroSupportCards,
  openDatabase,
  replaceCubeRunCards,
  upsertCard,
  upsertCubeRun,
  upsertPipelineRun
} from "../db/index.js";
import type { CubeCardRole } from "../types/contracts.js";
import { validateCube, validateCubeCards, type ValidationCard } from "./validation.js";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("cube validation", () => {
  it("reports color counts and mana curve metrics", () => {
    const report = validateCubeCards(
      "validation-test",
      [
        validationCard("Lightning Bolt", "Red", ["glue"], 1, "Instant"),
        validationCard("Tarmogoyf", "Green", ["support"], 2, "Creature"),
        validationCard("Steam Vents", "Lands", ["fixing"], 0, "Land")
      ],
      testConfig()
    );

    expect(metricValue(report.metrics, "color.Red")).toBe(1);
    expect(metricValue(report.metrics, "color.Green")).toBe(1);
    expect(metricValue(report.metrics, "color.Lands")).toBe(1);
    expect(metricValue(report.metrics, "curve.Red.1")).toBe(1);
    expect(metricValue(report.metrics, "ratio.creature")).toBe(1);
  });

  it("highlights under-supported and over-supported archetypes", () => {
    const report = validateCubeCards(
      "validation-test",
      [
        validationCard("Splinter Twin", "Red", ["support"], 4, "Enchantment", "support: top=Twin:0.8"),
        validationCard("Deceiver Exarch", "Blue", ["support"], 3, "Creature", "support: top=Twin:0.7"),
        validationCard("Birthing Pod", "Green", ["support"], 4, "Artifact", "support: top=Birthing Pod:0.9")
      ],
      testConfig({ maximumSupportPerArchetype: 1, minimumSupportPerArchetype: 2 })
    );

    expect(metricValue(report.metrics, "support.archetype.twin")).toBe(2);
    expect(metricValue(report.metrics, "support.archetype.birthing_pod")).toBe(1);
    expect(report.warnings.map((row) => row.code)).toContain("support.archetype_over_supported");
    expect(report.warnings.map((row) => row.code)).toContain("support.archetype_under_supported");
  });

  it("persists validation runs, warnings, metrics, zero-support rows, and CSV exports", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    upsertPipelineRun(database, {
      configHash: "validation",
      id: "validation-pipeline",
      status: "completed"
    });
    seedCards(database);
    upsertCubeRun(database, {
      config: { totalCards: 4 },
      id: "cube-validation-test",
      pipelineRunId: "validation-pipeline",
      totalCards: 4
    });
    replaceCubeRunCards(database, "cube-validation-test", [
      cubeCard("Lightning Bolt", 0, ["glue"], "glue removal"),
      cubeCard("Splinter Twin", 1, ["support"], "support: top=Twin:0.8"),
      cubeCard("Birthing Pod", 2, ["support"], "support: top=Birthing Pod:0.9"),
      cubeCard("Tarmogoyf", 3, ["role"], "role filler")
    ]);
    const outputCsvPath = path.join(mkdtempSync(path.join(os.tmpdir(), "cube-refiner-validation-")), "cube_validation_report.csv");

    const summary = validateCube(database, {
      colorTargets: { Green: 2, Red: 2 },
      cubeRunId: "cube-validation-test",
      maximumZeroSupportCards: 1,
      minimumArchetypeSupport: 3,
      minimumFixing: 1,
      minimumOneDrops: 2,
      minimumRemoval: 2,
      minimumSupportPerArchetype: 2,
      outputCsvPath,
      targetTolerance: 0,
      validationRunId: "validation-run"
    });

    expect(summary.status).toBe("warn");
    expect(database.prepare("SELECT status, total_cards AS totalCards FROM validation_runs WHERE id = ?").get("validation-run")).toEqual({
      status: "warn",
      totalCards: 4
    });
    expect(metricValue(listValidationMetrics(database, "validation-run"), "color.Red")).toBe(2);
    expect(metricValue(listValidationMetrics(database, "validation-run"), "support.zero_count")).toBe(2);
    expect(listValidationWarnings(database, "validation-run").map((row) => row.code)).toContain("support.zero_support");
    expect(listValidationZeroSupportCards(database, "validation-run").map((row) => row.cardName)).toEqual([
      "Lightning Bolt",
      "Tarmogoyf"
    ]);
    expect(readFileSync(outputCsvPath, "utf8")).toContain("support.zero_support_card");
  });
});

function seedCards(database: DatabaseSync): void {
  for (const entry of [
    card("Lightning Bolt", "Instant", 1, ["R"]),
    card("Splinter Twin", "Enchantment", 4, ["R"]),
    card("Birthing Pod", "Artifact", 4, []),
    card("Tarmogoyf", "Creature", 2, ["G"])
  ]) {
    upsertCard(database, entry);
  }
}

function validationCard(
  cardName: string,
  section: ValidationCard["section"],
  roles: readonly CubeCardRole[],
  manaValue: number,
  typeLine: string,
  reason = roles.join(" ")
): ValidationCard {
  return {
    card: card(cardName, typeLine, manaValue, section === "Red" ? ["R"] : section === "Green" ? ["G"] : section === "Blue" ? ["U"] : []),
    cardName,
    cubeRunId: "cube-test",
    position: 0,
    reason,
    roles,
    section
  };
}

function card(canonicalName: string, typeLine: string, manaValue: number, colors: readonly string[]) {
  return {
    canonicalName,
    colorIdentity: colors,
    colors,
    manaValue,
    typeLine
  };
}

function cubeCard(cardName: string, position: number, roles: readonly CubeCardRole[], reason: string) {
  return {
    cardName,
    cubeRunId: "cube-validation-test",
    position,
    reason,
    roles
  };
}

function testConfig(overrides: Partial<Parameters<typeof validateCubeCards>[2]> = {}): Parameters<typeof validateCubeCards>[2] {
  return {
    colorTargets: {
      Green: 1,
      Lands: 1,
      Red: 1
    },
    maximumSupportPerArchetype: 99,
    maximumZeroSupportCards: 99,
    minimumArchetypeSupport: 0,
    minimumFixing: 0,
    minimumOneDrops: 0,
    minimumRemoval: 0,
    minimumSupportPerArchetype: 0,
    targetTolerance: 0,
    ...overrides
  };
}

function metricValue(metrics: readonly { readonly metricKey: string; readonly value: number }[], key: string): number | undefined {
  return metrics.find((row) => row.metricKey === key)?.value;
}
