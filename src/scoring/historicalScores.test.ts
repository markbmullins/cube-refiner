import { describe, expect, it } from "vitest";

import type { HistoricalScoreInputRow } from "../db/repository.js";
import type { CardScoreRow } from "../types/contracts.js";
import { calculateHistoricalCardScores, defaultHistoricalScoreConfig } from "./historicalScores.js";

describe("historical Modern legacy scoring", () => {
  it("classifies long-lived staples, short peaks, and sideboard spikes", () => {
    const scores = calculateHistoricalCardScores(
      [
        historicalRow("Lightning Bolt", "p1", 0.4, ["Burn"], 8, 0),
        historicalRow("Lightning Bolt", "p2", 0.35, ["Burn", "Jund"], 8, 0),
        historicalRow("Lightning Bolt", "p3", 0.3, ["Jund"], 8, 0),
        historicalRow("Lightning Bolt", "p4", 0.25, ["Control"], 8, 0),
        historicalRow("Siege Rhino", "p2", 0.32, ["Abzan"], 4, 0),
        historicalRow("Rest in Peace", "p3", 0.3, ["Control"], 0, 8)
      ],
      4,
      new Map([
        ["Lightning Bolt", aggregateScore("Lightning Bolt", 0.8)],
        ["Siege Rhino", aggregateScore("Siege Rhino", 0.2)],
        ["Rest in Peace", aggregateScore("Rest in Peace", 0.1)]
      ]),
      defaultHistoricalScoreConfig,
      "historical-test",
      "config-hash-test"
    );

    expect(
      scores.map((score) => ({
        cardName: score.cardName,
        configHash: score.configHash,
        eraScore: score.eraScore,
        explanation: score.explanation,
        historicalRole: score.historicalRole,
        longevityScore: score.longevityScore,
        peakScore: score.peakScore
      }))
    ).toEqual([
      {
        cardName: "Lightning Bolt",
        configHash: "config-hash-test",
        eraScore: 4,
        explanation: expect.stringContaining("pillar_threshold=0.5"),
        historicalRole: "format_pillar",
        longevityScore: 1,
        peakScore: 0.4
      },
      {
        cardName: "Siege Rhino",
        configHash: "config-hash-test",
        eraScore: 1,
        explanation: expect.stringContaining("icon_threshold=0.18"),
        historicalRole: "archetype_icon",
        longevityScore: 0.25,
        peakScore: 0.32
      },
      {
        cardName: "Rest in Peace",
        configHash: "config-hash-test",
        eraScore: 1,
        explanation: expect.stringContaining("flash_threshold=0.25"),
        historicalRole: "flash_in_the_pan",
        longevityScore: 0.25,
        peakScore: 0.3
      }
    ]);
  });

  it("changes role classifications and scores under a stricter config", () => {
    const rows = [
      historicalRow("Lightning Bolt", "p1", 0.4, ["Burn"], 8, 0),
      historicalRow("Lightning Bolt", "p2", 0.35, ["Burn", "Jund"], 8, 0),
      historicalRow("Siege Rhino", "p2", 0.32, ["Abzan"], 4, 0),
      historicalRow("Rest in Peace", "p3", 0.3, ["Control"], 0, 8)
    ];
    const defaultScores = calculateHistoricalCardScores(rows, 4, new Map(), defaultHistoricalScoreConfig, "default");
    const strictScores = calculateHistoricalCardScores(
      rows,
      4,
      new Map(),
      {
        ...defaultHistoricalScoreConfig,
        thresholds: {
          ...defaultHistoricalScoreConfig.thresholds,
          flashPeak: 0.35,
          iconPeak: 0.35,
          pillarLongevity: 0.75
        },
        weights: {
          ...defaultHistoricalScoreConfig.weights,
          peak: 0.8
        }
      },
      "strict"
    );

    expect(defaultScores.find((score) => score.cardName === "Siege Rhino")?.historicalRole).toBe("archetype_icon");
    expect(strictScores.find((score) => score.cardName === "Siege Rhino")?.historicalRole).toBe("role_player");
    expect(strictScores.find((score) => score.cardName === "Lightning Bolt")?.modernLegacyScore).toBeGreaterThan(
      defaultScores.find((score) => score.cardName === "Lightning Bolt")?.modernLegacyScore ?? 0
    );
  });

  it("persists manual role overrides in explanations and score rows", () => {
    const scores = calculateHistoricalCardScores(
      [historicalRow("Siege Rhino", "p2", 0.12, ["Abzan"], 4, 0)],
      4,
      new Map(),
      {
        ...defaultHistoricalScoreConfig,
        manualOverrides: [
          {
            cardName: "Siege Rhino",
            reason: "cube thesis card",
            role: "format_pillar",
            scoreAdjustment: 0.5
          }
        ]
      },
      "manual",
      "manual-config"
    );

    expect(scores[0]).toEqual(
      expect.objectContaining({
        cardName: "Siege Rhino",
        configHash: "manual-config",
        historicalRole: "format_pillar"
      })
    );
    expect(scores[0]?.explanation).toContain("manual_override=cube thesis card");
  });
});

function historicalRow(
  cardName: string,
  periodId: string,
  metagameShare: number,
  archetypeFamilies: readonly string[],
  mainboardCopies: number,
  sideboardCopies: number
): HistoricalScoreInputRow {
  return {
    archetypeFamilies,
    cardName,
    mainboardCopies,
    metagameShare,
    periodId,
    sideboardCopies
  };
}

function aggregateScore(cardName: string, weightedGlueScore: number): CardScoreRow {
  return {
    cardName,
    cubeScore: weightedGlueScore,
    exclusivityScore: 0,
    frequency: 1,
    glueScore: weightedGlueScore,
    highestAffinity: 0,
    parasiticScore: 0,
    secondHighestAffinity: 0,
    signpostScore: 0,
    weightedGlueScore
  };
}
