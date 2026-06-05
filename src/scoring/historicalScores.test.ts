import { describe, expect, it } from "vitest";

import type { HistoricalScoreInputRow } from "../db/repository.js";
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
        ["Lightning Bolt", 0.8],
        ["Siege Rhino", 0.2],
        ["Rest in Peace", 0.1]
      ]),
      defaultHistoricalScoreConfig,
      "historical-test"
    );

    expect(
      scores.map((score) => ({
        cardName: score.cardName,
        eraScore: score.eraScore,
        historicalRole: score.historicalRole,
        longevityScore: score.longevityScore,
        peakScore: score.peakScore
      }))
    ).toEqual([
      {
        cardName: "Lightning Bolt",
        eraScore: 4,
        historicalRole: "format_pillar",
        longevityScore: 1,
        peakScore: 0.4
      },
      {
        cardName: "Siege Rhino",
        eraScore: 1,
        historicalRole: "archetype_icon",
        longevityScore: 0.25,
        peakScore: 0.32
      },
      {
        cardName: "Rest in Peace",
        eraScore: 1,
        historicalRole: "flash_in_the_pan",
        longevityScore: 0.25,
        peakScore: 0.3
      }
    ]);
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
