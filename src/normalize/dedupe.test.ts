import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigrations, openDatabase, upsertNormalizedDeck } from "../db/index.js";
import { deckFingerprint, dedupeDecks, mainboardOverlap } from "./dedupe.js";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("deck dedupe", () => {
  it("creates deterministic fingerprints from sorted mainboard names and counts", () => {
    const left = deckFingerprint([
      { copies: 4, name: "Lightning Bolt" },
      { copies: 2, name: "Snapcaster Mage" }
    ]);
    const right = deckFingerprint([
      { copies: 2, name: "Snapcaster Mage" },
      { copies: 4, name: "Lightning Bolt" }
    ]);

    expect(left).toBe(right);
  });

  it("counts overlapping mainboard copies", () => {
    expect(
      mainboardOverlap(
        [
          { copies: 4, name: "Lightning Bolt" },
          { copies: 4, name: "Snapcaster Mage" }
        ],
        [
          { copies: 3, name: "Lightning Bolt" },
          { copies: 1, name: "Cryptic Command" }
        ]
      )
    ).toBe(3);
  });

  it("persists exact duplicate and near-duplicate clusters with deck weights", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    upsertNormalizedDeck(database, normalizedDeck("deck-a", "2017-06-01", "Twin", numberedCards(60)));
    upsertNormalizedDeck(database, normalizedDeck("deck-b", "2017-06-12", "Twin", numberedCards(60)));
    upsertNormalizedDeck(database, normalizedDeck("deck-c", "2017-06-20", "Twin", numberedCards(59, "Variant Card")));
    upsertNormalizedDeck(
      database,
      normalizedDeck("deck-d", "2017-07-01", "Twin", [
        ...numberedCards(58),
        { copies: 1, name: "July Card A" },
        { copies: 1, name: "July Card B" }
      ])
    );
    const reportCsvPath = path.join(mkdtempSync(path.join(os.tmpdir(), "cube-refiner-dedupe-")), "dedupe.csv");

    const summary = dedupeDecks(database, { reportCsvPath });

    expect(summary).toEqual({
      exactClusters: 1,
      nearClusters: 1,
      reportCsvPath,
      weightedDecks: 4
    });
    expect(
      database
        .prepare(
          `SELECT deck_id AS deckId, weight, exact_duplicate_cluster_id AS exactCluster, near_duplicate_cluster_id AS nearCluster
           FROM deck_weights
           ORDER BY deck_id`
        )
        .all()
    ).toEqual([
      {
        deckId: "deck-a",
        exactCluster: expect.any(String),
        nearCluster: expect.any(String),
        weight: 0.5
      },
      {
        deckId: "deck-b",
        exactCluster: expect.any(String),
        nearCluster: null,
        weight: 0
      },
      {
        deckId: "deck-c",
        exactCluster: null,
        nearCluster: expect.any(String),
        weight: 0.5
      },
      {
        deckId: "deck-d",
        exactCluster: null,
        nearCluster: null,
        weight: 1
      }
    ]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM dedupe_clusters WHERE strategy = 'exact'").get()).toEqual({
      count: 1
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM dedupe_clusters WHERE strategy = 'near'").get()).toEqual({
      count: 1
    });
    expect(readFileSync(reportCsvPath, "utf8")).toContain("exact,");
    expect(readFileSync(reportCsvPath, "utf8")).toContain("near,");
  });
});

function normalizedDeck(
  deckId: string,
  eventDate: string,
  archetypeFamily: string,
  mainboard: readonly { readonly copies: number; readonly name: string }[]
) {
  return {
    archetype: archetypeFamily,
    archetypeFamily,
    deckId,
    eventDate,
    fingerprint: "placeholder",
    mainboard,
    sideboard: [],
    source: "mtgo" as const,
    sourceUrl: `https://example.test/${deckId}`,
    weight: 1,
    year: Number(eventDate.slice(0, 4))
  };
}

function numberedCards(count: number, finalCardName?: string): readonly { readonly copies: number; readonly name: string }[] {
  return [
    ...Array.from({ length: count }, (_, index) => ({
      copies: 1,
      name: `Card ${String(index + 1).padStart(2, "0")}`
    })),
    ...(finalCardName ? [{ copies: 1, name: finalCardName }] : [])
  ];
}
