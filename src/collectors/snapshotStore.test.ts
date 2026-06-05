import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigrations, openDatabase } from "../db/index.js";
import { createSnapshotStore, sanitizePathSegment } from "./snapshotStore.js";
import type { Fetcher } from "./types.js";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("collector snapshot store", () => {
  it("fetches, persists, and reuses cached text snapshots", async () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    const rawDataDir = mkdtempSync(path.join(os.tmpdir(), "cube-refiner-raw-"));
    let fetchCount = 0;
    const fetcher: Fetcher = async () => {
      fetchCount += 1;
      return {
        ok: true,
        status: 200,
        text: async () => "<html>decklist</html>"
      };
    };

    const store = createSnapshotStore({ database, fetcher, rawDataDir });
    const first = await store.fetchText({
      cacheKey: "modern-2015",
      source: "mtgtop8",
      url: "https://example.test/modern"
    });
    const second = await store.fetchText({
      cacheKey: "modern-2015",
      source: "mtgtop8",
      url: "https://example.test/modern"
    });

    const snapshotCount = database.prepare("SELECT COUNT(*) AS count FROM source_snapshots").get();

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(first.contentHash).toBe(second.contentHash);
    expect(readFileSync(first.filePath, "utf8")).toBe("<html>decklist</html>");
    expect(fetchCount).toBe(1);
    expect(Number(snapshotCount?.count)).toBe(1);
  });

  it("writes parsed deck snapshots as source-specific JSON", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    const rawDataDir = mkdtempSync(path.join(os.tmpdir(), "cube-refiner-raw-"));
    const store = createSnapshotStore({
      database,
      fetcher: async () => ({
        ok: true,
        status: 200,
        text: async () => ""
      }),
      rawDataDir
    });

    const filePath = store.writeParsedDecks("mtgo", "2015 league", [
      {
        format: "Modern",
        mainboard: [{ copies: 4, name: "Lightning Bolt" }],
        sideboard: [],
        source: "mtgo",
        sourceUrl: "https://example.test/deck"
      }
    ]);

    expect(filePath).toContain(path.join("mtgo", "parsed", "2015-league.json"));
    expect(existsSync(filePath)).toBe(true);
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toHaveLength(1);
  });

  it("sanitizes arbitrary cache keys into stable file names", () => {
    expect(sanitizePathSegment("https://example.test/Modern Decks?year=2015")).toBe(
      "example.test-modern-decks-year-2015"
    );
  });
});
