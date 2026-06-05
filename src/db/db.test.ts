import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "./connection.js";
import { applyMigrations } from "./migrations.js";
import {
  listMatrixInputRows,
  upsertArchetypeMapping,
  upsertCard,
  upsertCardNameMapping,
  upsertNormalizedDeck,
  upsertRawDeck,
  upsertSourceSnapshot
} from "./repository.js";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("SQLite persistence", () => {
  it("initializes an on-disk database and records applied migrations", () => {
    const databasePath = path.join(mkdtempSync(path.join(os.tmpdir(), "cube-refiner-")), "test.sqlite");
    database = openDatabase({ path: databasePath });

    const applied = applyMigrations(database);
    const migrationRow = database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get();
    const tableRow = database
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'raw_decks'")
      .get();

    expect(applied).toEqual(["0001_initial_schema"]);
    expect(Number(migrationRow?.count)).toBe(1);
    expect(Number(tableRow?.count)).toBe(1);
  });

  it("upserts source snapshots, raw decks, cards, and mappings", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);

    const snapshotId = upsertSourceSnapshot(database, {
      contentHash: "hash-1",
      fetchedAt: "2026-06-05T12:00:00.000Z",
      httpStatus: 200,
      source: "mtgtop8",
      sourceUrl: "https://example.test/event"
    });

    const rawDeckId = upsertRawDeck(
      database,
      {
        eventDate: "2015-06-01",
        format: "Modern",
        mainboard: [{ copies: 4, name: "Lightning Bolt" }],
        reportedArchetype: "Jund",
        sideboard: [{ copies: 2, name: "Ancient Grudge" }],
        source: "mtgtop8",
        sourceUrl: "https://example.test/deck"
      },
      { snapshotId }
    );

    upsertCard(database, {
      canonicalName: "Wear // Tear",
      colorIdentity: ["R", "W"],
      colors: ["R", "W"],
      manaValue: 3,
      typeLine: "Instant"
    });
    upsertCardNameMapping(database, {
      canonicalName: "Wear // Tear",
      rawName: "Wear/Tear",
      status: "mapped"
    });
    upsertArchetypeMapping(database, {
      archetype: "Jund",
      archetypeFamily: "BGx Midrange",
      reportedLabel: "Black Green Red Midrange"
    });

    const cardCount = database
      .prepare("SELECT COUNT(*) AS count FROM raw_deck_cards WHERE raw_deck_id = ?")
      .get(rawDeckId);
    const mapping = database
      .prepare("SELECT canonical_name AS canonicalName FROM card_name_mappings WHERE raw_name = ?")
      .get("Wear/Tear");

    expect(Number(cardCount?.count)).toBe(2);
    expect(mapping?.canonicalName).toBe("Wear // Tear");
  });

  it("lists normalized deck card rows with persisted deck weights for matrix generation", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);

    upsertNormalizedDeck(database, {
      archetype: "Jund",
      archetypeFamily: "BGx Midrange",
      deckId: "deck-1",
      eventDate: "2015-06-01",
      fingerprint: "fingerprint-1",
      mainboard: [
        { copies: 4, name: "Lightning Bolt" },
        { copies: 4, name: "Tarmogoyf" }
      ],
      sideboard: [{ copies: 2, name: "Ancient Grudge" }],
      source: "mtgo",
      sourceUrl: "https://example.test/deck-1",
      weight: 0.5,
      year: 2015
    });

    const rows = listMatrixInputRows(database);

    expect(rows).toEqual([
      {
        archetypeFamily: "BGx Midrange",
        cardName: "Lightning Bolt",
        copies: 4,
        deckId: "deck-1",
        weight: 0.5,
        zone: "mainboard"
      },
      {
        archetypeFamily: "BGx Midrange",
        cardName: "Tarmogoyf",
        copies: 4,
        deckId: "deck-1",
        weight: 0.5,
        zone: "mainboard"
      },
      {
        archetypeFamily: "BGx Midrange",
        cardName: "Ancient Grudge",
        copies: 2,
        deckId: "deck-1",
        weight: 0.5,
        zone: "sideboard"
      }
    ]);
  });
});
