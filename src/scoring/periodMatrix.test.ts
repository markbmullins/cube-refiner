import { describe, expect, it } from "vitest";

import type { PeriodMatrixInputRow } from "../db/repository.js";
import { calculatePeriodMatrices } from "./periodMatrix.js";

describe("period-aware matrices", () => {
  it("calculates card metagame share across long-lived and short-peak cards", () => {
    const result = calculatePeriodMatrices(periodRows, "period-run");

    expect(
      result.cardRows.map((row) => ({
        archetypeFamilies: row.archetypeFamilies,
        cardName: row.cardName,
        decksWithCard: row.decksWithCard,
        metagameShare: row.metagameShare,
        periodId: row.periodId,
        totalDecksInPeriod: row.totalDecksInPeriod
      }))
    ).toEqual([
      {
        archetypeFamilies: ["Control", "Jund"],
        cardName: "Lightning Bolt",
        decksWithCard: 2,
        metagameShare: 1,
        periodId: "p1",
        totalDecksInPeriod: 2
      },
      {
        archetypeFamilies: ["Jund"],
        cardName: "Tarmogoyf",
        decksWithCard: 1,
        metagameShare: 0.5,
        periodId: "p1",
        totalDecksInPeriod: 2
      },
      {
        archetypeFamilies: ["Tempo"],
        cardName: "Lightning Bolt",
        decksWithCard: 1,
        metagameShare: 0.5,
        periodId: "p2",
        totalDecksInPeriod: 2
      },
      {
        archetypeFamilies: ["Tempo"],
        cardName: "Treasure Cruise",
        decksWithCard: 2,
        metagameShare: 1,
        periodId: "p2",
        totalDecksInPeriod: 2
      },
      {
        archetypeFamilies: ["Burn"],
        cardName: "Lightning Bolt",
        decksWithCard: 1,
        metagameShare: 1,
        periodId: "p3",
        totalDecksInPeriod: 1
      }
    ]);
  });

  it("summarizes archetype period coverage from set-release period rows", () => {
    const result = calculatePeriodMatrices(periodRows, "period-run");

    expect(
      result.archetypeRows.map((row) => ({
        archetypeFamily: row.archetypeFamily,
        periodId: row.periodId,
        periodMetagameShare: row.periodMetagameShare,
        representativeCards: row.representativeCards,
        totalDeckWeight: row.totalDeckWeight,
        uniqueCards: row.uniqueCards
      }))
    ).toEqual([
      {
        archetypeFamily: "Control",
        periodId: "p1",
        periodMetagameShare: 0.5,
        representativeCards: ["Lightning Bolt"],
        totalDeckWeight: 1,
        uniqueCards: 1
      },
      {
        archetypeFamily: "Jund",
        periodId: "p1",
        periodMetagameShare: 0.5,
        representativeCards: ["Lightning Bolt", "Tarmogoyf"],
        totalDeckWeight: 1,
        uniqueCards: 2
      },
      {
        archetypeFamily: "Tempo",
        periodId: "p2",
        periodMetagameShare: 1,
        representativeCards: ["Treasure Cruise", "Lightning Bolt"],
        totalDeckWeight: 2,
        uniqueCards: 2
      },
      {
        archetypeFamily: "Burn",
        periodId: "p3",
        periodMetagameShare: 1,
        representativeCards: ["Lightning Bolt"],
        totalDeckWeight: 1,
        uniqueCards: 1
      }
    ]);
  });
});

const periodRows: readonly PeriodMatrixInputRow[] = [
  periodRow("p1", 0, "d1", "Jund", "Lightning Bolt"),
  periodRow("p1", 0, "d1", "Jund", "Tarmogoyf"),
  periodRow("p1", 0, "d2", "Control", "Lightning Bolt"),
  periodRow("p2", 1, "d3", "Tempo", "Lightning Bolt"),
  periodRow("p2", 1, "d3", "Tempo", "Treasure Cruise"),
  periodRow("p2", 1, "d4", "Tempo", "Treasure Cruise"),
  periodRow("p3", 2, "d5", "Burn", "Lightning Bolt")
];

function periodRow(
  periodId: string,
  sortOrder: number,
  deckId: string,
  archetypeFamily: string,
  cardName: string
): PeriodMatrixInputRow {
  return {
    archetypeFamily,
    cardName,
    copies: 4,
    deckId,
    periodEndDate: `2011-0${sortOrder + 2}-01`,
    periodId,
    periodStartDate: `2011-0${sortOrder + 1}-01`,
    setCode: periodId,
    setName: `Period ${periodId}`,
    sortOrder,
    weight: 1,
    zone: "mainboard"
  };
}
