import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigrations, openDatabase, upsertRawDeck } from "../db/index.js";
import {
  cardNameKeys,
  createCardNameResolver,
  importScryfallCards,
  normalizeCards,
  primaryCardNameKey
} from "./cards.js";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("card normalization", () => {
  it("builds lookup keys for exact, punctuation, casing, and split-card variants", () => {
    expect(primaryCardNameKey("  wear // tear ")).toBe("weartear");
    expect(cardNameKeys("Wear // Tear")).toEqual(["weartear"]);

    const resolver = createCardNameResolver(["Wear // Tear", "Grafdigger's Cage", "Lightning Bolt"]);

    expect(resolver("wear tear")).toBe("Wear // Tear");
    expect(resolver("Wear/Tear")).toBe("Wear // Tear");
    expect(resolver("GRAFDIGGER'S CAGE")).toBe("Grafdigger's Cage");
    expect(resolver("Lightning Bolt")).toBe("Lightning Bolt");
  });

  it("imports Scryfall-style records into canonical card storage", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);

    const imported = importScryfallCards(database, [
      {
        cmc: 1,
        color_identity: ["R"],
        colors: ["R"],
        id: "bolt-id",
        name: "Lightning Bolt",
        type_line: "Instant"
      },
      {
        layout: "token",
        name: "Goblin Token"
      }
    ]);

    expect(imported).toBe(1);
    expect(database.prepare("SELECT canonical_name AS name FROM cards").all()).toEqual([{ name: "Lightning Bolt" }]);
  });

  it("normalizes raw deck cards into canonical deck-card rows and writes an audit CSV", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    importScryfallCards(database, [
      { name: "Lightning Bolt" },
      { name: "Grafdigger's Cage" },
      { name: "Wear // Tear" },
      { name: "Ancient Grudge" }
    ]);
    upsertRawDeck(database, {
      eventDate: "2017-06-18",
      format: "Modern",
      mainboard: [
        { copies: 4, name: "lightning bolt" },
        { copies: 1, name: "Grafdigger&#39;s Cage" }
      ],
      reportedArchetype: "Jeskai Control",
      sideboard: [
        { copies: 1, name: "Wear/Tear" },
        { copies: 2, name: "Ancient Grudge" }
      ],
      source: "mtggoldfish",
      sourceUrl: "https://example.test/deck/1"
    });
    const auditCsvPath = path.join(mkdtempSync(path.join(os.tmpdir(), "cube-refiner-normalize-")), "audit.csv");

    const summary = normalizeCards(database, { auditCsvPath });

    expect(summary).toEqual({
      auditCsvPath,
      mappedNames: 4,
      normalizedDecks: 1,
      unresolvedNames: 0
    });
    expect(
      database
        .prepare(
          `SELECT zone, card_name AS cardName, copies
           FROM normalized_deck_cards
           ORDER BY zone, position`
        )
        .all()
    ).toEqual([
      { cardName: "Lightning Bolt", copies: 4, zone: "mainboard" },
      { cardName: "Grafdigger's Cage", copies: 1, zone: "mainboard" },
      { cardName: "Wear // Tear", copies: 1, zone: "sideboard" },
      { cardName: "Ancient Grudge", copies: 2, zone: "sideboard" }
    ]);
    expect(readFileSync(auditCsvPath, "utf8")).toContain("Wear/Tear,Wear // Tear,mapped");
  });

  it("quarantines unknown names with source context and can fail loudly", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    importScryfallCards(database, [{ name: "Lightning Bolt" }]);
    upsertRawDeck(database, {
      eventDate: "2017-06-18",
      format: "Modern",
      mainboard: [
        { copies: 4, name: "Lightning Bolt" },
        { copies: 1, name: "Mystery Card" }
      ],
      sideboard: [],
      source: "mtgo",
      sourceUrl: "https://example.test/deck/unknown"
    });

    const summary = normalizeCards(database);
    const unresolved = database
      .prepare(
        `SELECT raw_name AS rawName, status, source_context_json AS sourceContextJson
         FROM card_name_mappings
         WHERE raw_name = ?`
      )
      .get("Mystery Card");

    expect(summary.normalizedDecks).toBe(0);
    expect(summary.unresolvedNames).toBe(1);
    expect(unresolved?.status).toBe("unresolved");
    expect(JSON.parse(String(unresolved?.sourceContextJson))).toMatchObject({
      source: "mtgo",
      sourceUrl: "https://example.test/deck/unknown"
    });
    expect(() => normalizeCards(database as DatabaseSync, { failOnUnknown: true })).toThrow(
      "Unresolved card names: Mystery Card"
    );
  });
});
