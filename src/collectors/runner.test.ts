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
