import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigrations, openDatabase, upsertNormalizedDeck } from "../db/index.js";
import {
  archetypeKey,
  createArchetypeResolver,
  normalizeArchetypes
} from "./archetypes.js";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("archetype normalization", () => {
  it("normalizes known variants from the mapping data", () => {
    const resolver = createArchetypeResolver([
      {
        archetype: "BGx Midrange",
        archetypeFamily: "BGx Midrange",
        labels: ["Jund", "BGx Midrange", "Black Green Red Midrange"]
      },
      {
        archetype: "Twin",
        archetypeFamily: "Twin",
        labels: ["Splinter Twin", "Grixis Twin", "Temur Twin"]
      },
      {
        archetype: "Birthing Pod",
        archetypeFamily: "Birthing Pod",
        labels: ["Melira Pod", "Kiki Pod"]
      },
      {
        archetype: "Artifact Aggro",
        archetypeFamily: "Artifact Aggro",
        labels: ["Affinity", "Robots"]
      }
    ]);

    expect(resolver("Black Green Red Midrange")).toMatchObject({
      archetype: "BGx Midrange",
      archetypeFamily: "BGx Midrange",
      auditStatus: "mapped"
    });
    expect(resolver("grixis twin")).toMatchObject({
      archetype: "Twin",
      archetypeFamily: "Twin",
      auditStatus: "mapped"
    });
    expect(resolver("Kiki Pod")).toMatchObject({
      archetype: "Birthing Pod",
      archetypeFamily: "Birthing Pod",
      auditStatus: "mapped"
    });
    expect(resolver("Robots")).toMatchObject({
      archetype: "Artifact Aggro",
      archetypeFamily: "Artifact Aggro",
      auditStatus: "mapped"
    });
  });

  it("reports unmapped and ambiguous labels for review", () => {
    const resolver = createArchetypeResolver([
      {
        archetype: "Jeskai Control",
        archetypeFamily: "Control",
        labels: ["Jeskai"]
      },
      {
        archetype: "Jeskai Tempo",
        archetypeFamily: "Tempo",
        labels: ["Jeskai"]
      }
    ]);

    expect(resolver("Lantern Control")).toEqual({
      archetype: "Lantern Control",
      archetypeFamily: "Unmapped",
      auditStatus: "unmapped",
      confidence: 0,
      reportedLabel: "Lantern Control"
    });
    expect(resolver("Jeskai")).toEqual({
      archetype: "Jeskai",
      archetypeFamily: "Ambiguous",
      auditStatus: "ambiguous",
      confidence: 1,
      reportedLabel: "Jeskai"
    });
  });

  it("normalizes persisted decks, persists mapping audit rows, and writes an audit CSV", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    upsertNormalizedDeck(database, normalizedDeck("deck-jund", "Jund"));
    upsertNormalizedDeck(database, normalizedDeck("deck-affinity", "Robots"));
    upsertNormalizedDeck(database, normalizedDeck("deck-unknown", "Lantern Control"));
    const auditCsvPath = path.join(mkdtempSync(path.join(os.tmpdir(), "cube-refiner-archetypes-")), "audit.csv");

    const summary = normalizeArchetypes(database, {
      auditCsvPath,
      mappings: [
        {
          archetype: "BGx Midrange",
          archetypeFamily: "BGx Midrange",
          labels: ["Jund"]
        },
        {
          archetype: "Artifact Aggro",
          archetypeFamily: "Artifact Aggro",
          labels: ["Robots"]
        }
      ]
    });

    expect(summary).toEqual({
      ambiguousLabels: 0,
      auditCsvPath,
      mappedLabels: 2,
      normalizedDecks: 3,
      unmappedLabels: 1
    });
    expect(
      database
        .prepare(
          `SELECT deck_id AS deckId, archetype, archetype_family AS archetypeFamily
           FROM normalized_decks
           ORDER BY deck_id`
        )
        .all()
    ).toEqual([
      {
        archetype: "Artifact Aggro",
        archetypeFamily: "Artifact Aggro",
        deckId: "deck-affinity"
      },
      {
        archetype: "BGx Midrange",
        archetypeFamily: "BGx Midrange",
        deckId: "deck-jund"
      },
      {
        archetype: "Lantern Control",
        archetypeFamily: "Unmapped",
        deckId: "deck-unknown"
      }
    ]);
    expect(
      database
        .prepare(
          `SELECT reported_label AS label, archetype, archetype_family AS family, audit_status AS status
           FROM archetype_mappings
           ORDER BY reported_label`
        )
        .all()
    ).toEqual([
      { archetype: "BGx Midrange", family: "BGx Midrange", label: "Jund", status: "mapped" },
      { archetype: "Lantern Control", family: "Unmapped", label: "Lantern Control", status: "unmapped" },
      { archetype: "Artifact Aggro", family: "Artifact Aggro", label: "Robots", status: "mapped" }
    ]);
    expect(readFileSync(auditCsvPath, "utf8")).toContain("Lantern Control,Lantern Control,Unmapped,unmapped,0");
  });

  it("can fail loudly after persisting unresolved archetype labels", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    upsertNormalizedDeck(database, normalizedDeck("deck-unknown", "Lantern Control"));

    expect(() => normalizeArchetypes(database as DatabaseSync, { failOnUnmapped: true, mappings: [] })).toThrow(
      "Unresolved archetype labels: Lantern Control"
    );
    expect(
      database
        .prepare("SELECT audit_status AS status FROM archetype_mappings WHERE reported_label = ?")
        .get("Lantern Control")
    ).toEqual({ status: "unmapped" });
  });

  it("normalizes archetype keys", () => {
    expect(archetypeKey("  Black-Green/Red Midrange ")).toBe("blackgreenredmidrange");
  });
});

function normalizedDeck(deckId: string, archetype: string) {
  return {
    archetype,
    archetypeFamily: archetype,
    deckId,
    eventDate: "2017-06-18",
    fingerprint: `${deckId}-fingerprint`,
    mainboard: [{ copies: 4, name: "Lightning Bolt" }],
    sideboard: [],
    source: "mtgo" as const,
    sourceUrl: `https://example.test/${deckId}`,
    weight: 1,
    year: 2017
  };
}
