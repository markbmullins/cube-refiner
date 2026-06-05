import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigrations, openDatabase, upsertDeckWeight, upsertNormalizedDeck } from "../db/index.js";
import {
  buildCardArchetypeMatrix,
  calculateArchetypeSummaries,
  calculateCardArchetypeMatrix
} from "./matrix.js";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("card-archetype matrix", () => {
  it("calculates weighted matrix rows with separate mainboard and sideboard counts", () => {
    const rows = calculateCardArchetypeMatrix([
      {
        archetypeFamily: "Twin",
        cardName: "Lightning Bolt",
        copies: 4,
        deckId: "deck-1",
        weight: 1,
        zone: "mainboard"
      },
      {
        archetypeFamily: "Twin",
        cardName: "Dispel",
        copies: 2,
        deckId: "deck-1",
        weight: 1,
        zone: "sideboard"
      },
      {
        archetypeFamily: "Twin",
        cardName: "Lightning Bolt",
        copies: 4,
        deckId: "deck-2",
        weight: 0.5,
        zone: "mainboard"
      },
      {
        archetypeFamily: "Twin",
        cardName: "Ancient Grudge",
        copies: 1,
        deckId: "deck-2",
        weight: 0.5,
        zone: "sideboard"
      }
    ]);

    expect(rows).toEqual([
      {
        affinity: 0.5 / 1.5,
        archetypeFamily: "Twin",
        cardName: "Ancient Grudge",
        decksWithCard: 0.5,
        mainboardCopies: 0,
        sideboardCopies: 0.5,
        totalDecksInArchetype: 1.5
      },
      {
        affinity: 1 / 1.5,
        archetypeFamily: "Twin",
        cardName: "Dispel",
        decksWithCard: 1,
        mainboardCopies: 0,
        sideboardCopies: 2,
        totalDecksInArchetype: 1.5
      },
      {
        affinity: 1,
        archetypeFamily: "Twin",
        cardName: "Lightning Bolt",
        decksWithCard: 1.5,
        mainboardCopies: 6,
        sideboardCopies: 0,
        totalDecksInArchetype: 1.5
      }
    ]);
  });

  it("summarizes archetype rows from persisted matrix rows", () => {
    const summaries = calculateArchetypeSummaries([
      {
        archetypeFamily: "Burn",
        mainboardCopies: 4,
        sideboardCopies: 0,
        totalDecksInArchetype: 1
      },
      {
        archetypeFamily: "Burn",
        mainboardCopies: 0,
        sideboardCopies: 2,
        totalDecksInArchetype: 1
      }
    ]);

    expect(summaries).toEqual([
      {
        archetypeFamily: "Burn",
        mainboardCopies: 4,
        sideboardCopies: 2,
        totalDeckWeight: 1,
        uniqueCards: 2
      }
    ]);
  });

  it("persists matrix rows and exports CSVs from SQLite", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    upsertNormalizedDeck(database, normalizedDeck("deck-1", "Twin", [{ copies: 4, name: "Lightning Bolt" }], [
      { copies: 2, name: "Dispel" }
    ]));
    upsertNormalizedDeck(database, normalizedDeck("deck-2", "Twin", [{ copies: 4, name: "Lightning Bolt" }], [
      { copies: 1, name: "Ancient Grudge" }
    ]));
    upsertDeckWeight(database, {
      deckId: "deck-2",
      explanation: "near duplicate",
      weight: 0.5
    });
    const outputDir = mkdtempSync(path.join(os.tmpdir(), "cube-refiner-matrix-"));
    const matrixCsvPath = path.join(outputDir, "card_archetype_matrix.csv");
    const archetypeSummaryCsvPath = path.join(outputDir, "archetypes_summary.csv");

    const summary = buildCardArchetypeMatrix(database, {
      archetypeSummaryCsvPath,
      matrixCsvPath,
      pipelineRunId: "matrix-test-run"
    });

    expect(summary).toEqual({
      archetypeSummaryCsvPath,
      archetypeSummaryRows: 1,
      matrixCsvPath,
      matrixRows: 3,
      pipelineRunId: "matrix-test-run"
    });
    expect(
      database
        .prepare(
          `SELECT card_name AS cardName, archetype_family AS family, decks_with_card AS decksWithCard,
                  total_decks_in_archetype AS totalDecks, mainboard_copies AS mainboardCopies,
                  sideboard_copies AS sideboardCopies, affinity
           FROM card_archetype_matrix
           WHERE pipeline_run_id = ?
           ORDER BY archetype_family, card_name`
        )
        .all("matrix-test-run")
    ).toEqual([
      {
        affinity: 0.5 / 1.5,
        cardName: "Ancient Grudge",
        decksWithCard: 0.5,
        family: "Twin",
        mainboardCopies: 0,
        sideboardCopies: 0.5,
        totalDecks: 1.5
      },
      {
        affinity: 1 / 1.5,
        cardName: "Dispel",
        decksWithCard: 1,
        family: "Twin",
        mainboardCopies: 0,
        sideboardCopies: 2,
        totalDecks: 1.5
      },
      {
        affinity: 1,
        cardName: "Lightning Bolt",
        decksWithCard: 1.5,
        family: "Twin",
        mainboardCopies: 6,
        sideboardCopies: 0,
        totalDecks: 1.5
      }
    ]);
    expect(readFileSync(matrixCsvPath, "utf8")).toContain(
      "Lightning Bolt,Twin,1.5,1.5,6,0,1"
    );
    expect(readFileSync(archetypeSummaryCsvPath, "utf8")).toContain("Twin,1.5,3,6,2.5");
  });
});

function normalizedDeck(
  deckId: string,
  archetypeFamily: string,
  mainboard: readonly { readonly copies: number; readonly name: string }[],
  sideboard: readonly { readonly copies: number; readonly name: string }[]
) {
  return {
    archetype: archetypeFamily,
    archetypeFamily,
    deckId,
    eventDate: "2017-06-18",
    fingerprint: `${deckId}-fingerprint`,
    mainboard,
    sideboard,
    source: "mtgo" as const,
    sourceUrl: `https://example.test/${deckId}`,
    weight: 1,
    year: 2017
  };
}
