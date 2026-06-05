import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyMigrations,
  openDatabase,
  replaceCardArchetypeMatrixRows,
  upsertPipelineRun
} from "../db/index.js";
import {
  calculateCardScores,
  isSignpostCandidate,
  scoreCards
} from "./scores.js";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("card scoring", () => {
  it("distinguishes glue cards from signpost cards with synthetic matrix rows", () => {
    const rows = calculateCardScores(
      [
        matrixRow("Lightning Bolt", "Burn", 8, 10, 0.8),
        matrixRow("Lightning Bolt", "Jund", 5, 10, 0.5),
        matrixRow("Lightning Bolt", "Twin", 3, 10, 0.3),
        matrixRow("Splinter Twin", "Twin", 8, 10, 0.8),
        matrixRow("Splinter Twin", "Burn", 0.5, 10, 0.05)
      ],
      {
        cubeWeights: {
          frequency: 0.25,
          glue: 0.45,
          nostalgia: 0.1,
          parasiticPenalty: 0.15,
          sideboardOnlyPenalty: 0.2,
          signpost: 0.2
        },
        glueAffinityThreshold: 0.1,
        nostalgiaScores: {},
        parasiticWhitelist: [],
        signpostAffinityThreshold: 0.6,
        signpostExclusivityThreshold: 0.4,
        signpostMinDecksWithCard: 5
      }
    );
    const bolt = rows.find((row) => row.cardName === "Lightning Bolt");
    const twin = rows.find((row) => row.cardName === "Splinter Twin");

    expect(bolt?.glueScore).toBe(3);
    expect(twin?.glueScore).toBe(1);
    expect(twin?.exclusivityScore).toBe(0.75);
    expect(isSignpostCandidate(twin!)).toBe(true);
    expect(isSignpostCandidate(bolt!)).toBe(false);
    expect((bolt?.cubeScore ?? 0) > (twin?.cubeScore ?? 0)).toBe(true);
  });

  it("supports parasitic whitelists", () => {
    const [score] = calculateCardScores([matrixRow("Splinter Twin", "Twin", 8, 10, 0.8)], {
      cubeWeights: {
        frequency: 0.25,
        glue: 0.45,
        nostalgia: 0.1,
        parasiticPenalty: 0.15,
        sideboardOnlyPenalty: 0.2,
        signpost: 0.2
      },
      glueAffinityThreshold: 0.1,
      nostalgiaScores: {},
      parasiticWhitelist: ["Splinter Twin"],
      signpostAffinityThreshold: 0.6,
      signpostExclusivityThreshold: 0.4,
      signpostMinDecksWithCard: 5
    });

    expect(score?.parasiticScore).toBe(0);
  });

  it("persists scores and exports ranked/review CSVs", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    upsertPipelineRun(database, {
      configHash: "matrix-config",
      id: "score-test-run",
      status: "completed"
    });
    replaceCardArchetypeMatrixRows(database, "score-test-run", [
      { ...matrixRow("Lightning Bolt", "Burn", 8, 10, 0.8), pipelineRunId: "score-test-run" },
      { ...matrixRow("Lightning Bolt", "Jund", 4, 10, 0.4), pipelineRunId: "score-test-run" },
      { ...matrixRow("Splinter Twin", "Twin", 8, 10, 0.8), pipelineRunId: "score-test-run" },
      { ...matrixRow("Splinter Twin", "Burn", 0.5, 10, 0.05), pipelineRunId: "score-test-run" }
    ]);
    const outputDir = mkdtempSync(path.join(os.tmpdir(), "cube-refiner-scores-"));
    const cardsRankedCsvPath = path.join(outputDir, "cards_ranked.csv");
    const signpostCandidatesCsvPath = path.join(outputDir, "signpost_candidates.csv");
    const glueCardsCsvPath = path.join(outputDir, "glue_cards.csv");
    const parasiticReviewCsvPath = path.join(outputDir, "parasitic_review.csv");

    const summary = scoreCards(database, {
      cardsRankedCsvPath,
      glueCardsCsvPath,
      parasiticReviewCsvPath,
      pipelineRunId: "score-test-run",
      signpostCandidatesCsvPath
    });

    expect(summary.scoreRows).toBe(2);
    expect(
      database
        .prepare(
          `SELECT card_name AS cardName, glue_score AS glueScore, highest_affinity AS highestAffinity
           FROM card_scores
           WHERE pipeline_run_id = ?
           ORDER BY card_name`
        )
        .all("score-test-run")
    ).toEqual([
      { cardName: "Lightning Bolt", glueScore: 2, highestAffinity: 0.8 },
      { cardName: "Splinter Twin", glueScore: 1, highestAffinity: 0.8 }
    ]);
    expect(readFileSync(cardsRankedCsvPath, "utf8")).toContain("Lightning Bolt");
    expect(readFileSync(signpostCandidatesCsvPath, "utf8")).toContain("Splinter Twin");
    expect(readFileSync(glueCardsCsvPath, "utf8")).toContain("Lightning Bolt");
    expect(readFileSync(parasiticReviewCsvPath, "utf8")).toContain("Splinter Twin");
  });
});

function matrixRow(
  cardName: string,
  archetypeFamily: string,
  decksWithCard: number,
  totalDecksInArchetype: number,
  affinity: number
) {
  return {
    affinity,
    archetypeFamily,
    cardName,
    decksWithCard,
    mainboardCopies: decksWithCard * 4,
    sideboardCopies: 0,
    totalDecksInArchetype
  };
}
