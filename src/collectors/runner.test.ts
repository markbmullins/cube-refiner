import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { applyMigrations, openDatabase } from "../db/index.js";
import { runCollectors } from "./runner.js";
import type { Fetcher } from "./types.js";

describe("collector runner", () => {
  it("runs registered source commands independently and writes parsed snapshots", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cube-refiner-runner-"));
    const databasePath = path.join(root, "collector.sqlite");
    const rawDataDir = path.join(root, "raw");

    const summaries = await runCollectors({
      collectorOptions: {
        events: "https://www.mtggoldfish.com/tournament/test-modern",
        limitDecks: "1"
      },
      databasePath,
      fetcher: fakeMtgGoldfishFetcher,
      logger: {
        error: () => undefined,
        info: () => undefined,
        warn: () => undefined
      },
      rawDataDir,
      sources: ["mtggoldfish"]
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.source).toBe("mtggoldfish");
    expect(summaries[0]?.deckCount).toBe(1);
    expect(summaries[0]?.parsedOutputPath).toContain(path.join("mtggoldfish", "parsed"));
    expect(existsSync(summaries[0]?.parsedOutputPath ?? "")).toBe(true);
    expect(JSON.parse(readFileSync(summaries[0]?.parsedOutputPath ?? "", "utf8"))).toHaveLength(1);

    const database = openDatabase({ path: databasePath });
    try {
      applyMigrations(database);
      expect(database.prepare("SELECT COUNT(*) AS count FROM raw_decks WHERE source = ?").get("mtggoldfish")).toEqual({
        count: 1
      });
      expect(
        database
          .prepare(
            `SELECT zone, name, copies
             FROM raw_deck_cards
             ORDER BY zone, position`
          )
          .all()
      ).toEqual([
        { copies: 4, name: "Signal Pest", zone: "mainboard" },
        { copies: 4, name: "Steel Overseer", zone: "mainboard" },
        { copies: 2, name: "Ancient Grudge", zone: "sideboard" }
      ]);
    } finally {
      database.close();
    }
  });

  it("persists only active raw decks inside the configured historical date range", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cube-refiner-runner-dates-"));
    const databasePath = path.join(root, "collector.sqlite");

    const summaries = await runCollectors({
      collectorOptions: {
        endDate: "2019-04-30",
        events: [
          "https://www.mtggoldfish.com/tournament/before-modern",
          "https://www.mtggoldfish.com/tournament/modern-start",
          "https://www.mtggoldfish.com/tournament/default-end",
          "https://www.mtggoldfish.com/tournament/after-default-end"
        ].join(","),
        startDate: "2011-08-12"
      },
      databasePath,
      fetcher: boundaryDateFetcher,
      logger: {
        error: () => undefined,
        info: () => undefined,
        warn: () => undefined
      },
      rawDataDir: path.join(root, "raw"),
      sources: ["mtggoldfish"]
    });

    expect(summaries[0]?.deckCount).toBe(2);

    const database = openDatabase({ path: databasePath });
    try {
      applyMigrations(database);
      expect(database.prepare("SELECT event_date AS eventDate FROM raw_decks ORDER BY event_date").all()).toEqual([
        { eventDate: "2011-08-12" },
        { eventDate: "2019-04-30" }
      ]);
      expect(database.prepare("SELECT event_date AS eventDate, reason FROM collection_date_reviews ORDER BY event_date").all()).toEqual([
        { eventDate: "2011-08-11", reason: "out_of_range" },
        { eventDate: "2019-05-01", reason: "out_of_range" }
      ]);
    } finally {
      database.close();
    }
  });

  it("can persist unknown-date decks as inactive review items", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cube-refiner-runner-inactive-"));
    const databasePath = path.join(root, "collector.sqlite");

    const summaries = await runCollectors({
      collectionDatePolicy: {
        missingDateHandling: "persist_inactive"
      },
      collectorOptions: {
        events: "https://www.mtggoldfish.com/tournament/missing-date",
        startDate: "2011-08-12",
        endDate: "2019-04-30"
      },
      databasePath,
      fetcher: missingDateFetcher,
      logger: {
        error: () => undefined,
        info: () => undefined,
        warn: () => undefined
      },
      rawDataDir: path.join(root, "raw"),
      sources: ["mtggoldfish"]
    });

    expect(summaries[0]?.deckCount).toBe(0);

    const database = openDatabase({ path: databasePath });
    try {
      applyMigrations(database);
      expect(database.prepare("SELECT active, collection_status AS collectionStatus FROM raw_decks").all()).toEqual([
        { active: 0, collectionStatus: "missing_event_date" }
      ]);
      expect(database.prepare("SELECT reason FROM collection_date_reviews").all()).toEqual([
        { reason: "missing_event_date" }
      ]);
    } finally {
      database.close();
    }
  });
});

const fakeMtgGoldfishFetcher: Fetcher = async (url) => {
  const responses = new Map([
    [
      "https://www.mtggoldfish.com/tournament/test-modern",
      `
      <h2>Test Modern Open</h2>
      <p>Format: Modern<br> Date: 2017-06-18</p>
      <tr class='tournament-decklist-event'>
        <td>1st</td>
        <td><a href="/deck/12345">Affinity</a></td>
        <td><a href="/player/Test+Player">Test Player</a></td>
      </tr>
    `
    ],
    [
      "https://www.mtggoldfish.com/deck/12345",
      `
      <h1 class='title'>Affinity <span class='author'>by Test Player</span></h1>
      <p class='deck-container-information'>
      Format: Modern<br>
      Event: <a href="/tournament/test-modern">Test Modern Open</a>, 1st Place<br>
      Deck Date: Jun 18, 2017
      </p>
      <input type="hidden" name="deck_input[deck]" value="4 Signal Pest
4 Steel Overseer
sideboard
2 Ancient Grudge
" />
    `
    ]
  ]);
  const body = responses.get(url);

  return {
    ok: body !== undefined,
    status: body === undefined ? 404 : 200,
    text: async () => body ?? "Not found"
  };
};

const boundaryDateFetcher: Fetcher = async (url) => {
  const tournamentDate = /before-modern/.test(url)
    ? "2011-08-11"
    : /modern-start/.test(url)
      ? "2011-08-12"
      : /after-default-end/.test(url)
          ? "2019-05-01"
          : /default-end/.test(url)
            ? "2019-04-30"
            : undefined;
  const deckMatch = /\/deck\/([^/]+)/.exec(url);
  const body = deckMatch
    ? deckPage(deckMatch[1] ?? "deck", deckDateForDeck(deckMatch[1] ?? ""))
    : tournamentDate
      ? tournamentPage(url.split("/").at(-1) ?? "event", tournamentDate)
      : undefined;

  return {
    ok: body !== undefined,
    status: body === undefined ? 404 : 200,
    text: async () => body ?? "Not found"
  };
};

const missingDateFetcher: Fetcher = async (url) => {
  const body = /\/deck\/99999/.test(url)
    ? `
      <h1 class='title'>Burn <span class='author'>by Test Player</span></h1>
      <p class='deck-container-information'>
      Format: Modern<br>
      Event: <a href="/tournament/missing-date">Missing Date Modern</a>, 1st Place<br>
      </p>
      <input type="hidden" name="deck_input[deck]" value="4 Lightning Bolt
" />
    `
    : /missing-date/.test(url)
      ? `
      <h2>Missing Date Modern</h2>
      <p>Format: Modern</p>
      <tr class='tournament-decklist-event'>
        <td>1st</td>
        <td><a href="/deck/99999">Burn</a></td>
        <td><a href="/player/Test+Player">Test Player</a></td>
      </tr>
    `
      : undefined;

  return {
    ok: body !== undefined,
    status: body === undefined ? 404 : 200,
    text: async () => body ?? "Not found"
  };
};

function tournamentPage(slug: string, date: string): string {
  const deckId = deckIdForSlug(slug);
  return `
    <h2>${slug}</h2>
    <p>Format: Modern<br> Date: ${date}</p>
    <tr class='tournament-decklist-event'>
      <td>1st</td>
      <td><a href="/deck/${deckId}">Burn</a></td>
      <td><a href="/player/Test+Player">Test Player</a></td>
    </tr>
  `;
}

function deckPage(slug: string, date: string): string {
  return `
    <h1 class='title'>Burn <span class='author'>by Test Player</span></h1>
    <p class='deck-container-information'>
    Format: Modern<br>
    Event: <a href="/tournament/${slug}">${slug}</a>, 1st Place<br>
    Deck Date: ${date}
    </p>
    <input type="hidden" name="deck_input[deck]" value="4 Lightning Bolt
" />
  `;
}

function deckDateForDeck(slug: string): string {
  if (slug === "1001") return "Aug 11, 2011";
  if (slug === "1002") return "Aug 12, 2011";
  if (slug === "1003") return "Apr 30, 2019";
  return "May 1, 2019";
}

function deckIdForSlug(slug: string): string {
  if (slug === "before-modern") return "1001";
  if (slug === "modern-start") return "1002";
  if (slug === "default-end") return "1003";
  return "1004";
}
