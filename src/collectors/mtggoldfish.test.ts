import { describe, expect, it } from "vitest";

import {
  cleanText,
  parseMtgGoldfishDeckPage,
  parseMtgGoldfishDeckText,
  parseMtgGoldfishTournamentDeckLinks,
  parseMtgGoldfishTournamentMetadata,
  parseTournamentInputs
} from "./mtggoldfish.js";

describe("MTGGoldfish parser", () => {
  it("does not select default tournament archives when events are omitted", () => {
    expect(parseTournamentInputs(undefined)).toEqual([]);
  });

  it("normalizes configured tournament archive inputs", () => {
    expect(
      parseTournamentInputs(
        "modern-event-slug, 12345, https://www.mtggoldfish.com/tournament/test-modern"
      )
    ).toEqual([
      "https://www.mtggoldfish.com/tournament/modern-event-slug",
      "https://www.mtggoldfish.com/tournament/12345",
      "https://www.mtggoldfish.com/tournament/test-modern"
    ]);
  });

  it("parses Modern tournament metadata", () => {
    const metadata = parseMtgGoldfishTournamentMetadata(
      `
      <title>Modern Test Event 2017 (Modern) Decks</title>
      <h2>Modern Test Event 2017</h2>
      <p>Format: Modern<br> Date: 2017-06-18</p>
    `,
      "https://www.mtggoldfish.com/tournament/modern-test-event-2017"
    );

    expect(metadata).toEqual({
      eventDate: "2017-06-18",
      eventId: "modern-test-event-2017",
      eventName: "Modern Test Event 2017",
      format: "Modern",
      sourceUrl: "https://www.mtggoldfish.com/tournament/modern-test-event-2017"
    });
  });

  it("parses tournament deck rows with placement, archetype, and player", () => {
    const links = parseMtgGoldfishTournamentDeckLinks(`
      <tr class='tournament-decklist-event'>
        <td class='text-end'>1st</td>
        <td><a href="/deck/677415">Affinity</a></td>
        <td><a href="/player/Mani+Davoudi">Mani Davoudi</a></td>
        <td class='text-end tournament-decklist-toggle' data-deckId='677415'></td>
      </tr>
      <tr class='tournament-decklist-event'>
        <td class='text-end'>2nd</td>
        <td><a href="/deck/677413">Mono-White Hatebears</a></td>
        <td><a href="/player/Theau+Mery">Theau Mery</a></td>
      </tr>
    `);

    expect(links).toEqual([
      {
        deckId: "677415",
        placement: "1st",
        player: "Mani Davoudi",
        reportedArchetype: "Affinity",
        url: "https://www.mtggoldfish.com/deck/677415"
      },
      {
        deckId: "677413",
        placement: "2nd",
        player: "Theau Mery",
        reportedArchetype: "Mono-White Hatebears",
        url: "https://www.mtggoldfish.com/deck/677413"
      }
    ]);
  });

  it("parses deck text with sideboard markers", () => {
    const cards = parseMtgGoldfishDeckText(`
      4 Signal Pest
      1 Grafdigger&#39;s Cage
      sideboard
      1 Wear // Tear
      2 Ancient Grudge
    `);

    expect(cards).toEqual({
      mainboard: [
        { copies: 4, name: "Signal Pest" },
        { copies: 1, name: "Grafdigger's Cage" }
      ],
      sideboard: [
        { copies: 1, name: "Wear // Tear" },
        { copies: 2, name: "Ancient Grudge" }
      ]
    });
  });

  it("treats a blank line as a sideboard split for downloaded text exports", () => {
    const cards = parseMtgGoldfishDeckText(`
4 Arcbound Ravager
4 Blinkmoth Nexus

2 Ancient Grudge
1 Wear/Tear
`);

    expect(cards.sideboard).toEqual([
      { copies: 2, name: "Ancient Grudge" },
      { copies: 1, name: "Wear/Tear" }
    ]);
  });

  it("parses a deck page into a RawDeck", () => {
    const deck = parseMtgGoldfishDeckPage(
      `
      <h1 class='title'>
      Affinity
      <span class='author'>by Mani Davoudi</span>
      </h1>
      <p class='deck-container-information'>
      Format: Modern
      <br>
      Event: <a href="/tournament/24417">Grand Prix Las Vegas 2017 — Modern</a>,  1st Place
      <br>
      Deck Date: Jun 18, 2017
      </p>
      <input type="hidden" name="deck_input[deck]" id="deck_input_deck" value="4 Signal Pest
4 Steel Overseer
1 Grafdigger&#39;s Cage
sideboard
1 Wear // Tear
2 Ancient Grudge
" autocomplete="off" />
    `,
      {
        sourceUrl: "https://www.mtggoldfish.com/deck/677415"
      }
    );

    expect(deck).toEqual({
      eventDate: "2017-06-18",
      eventName: "Grand Prix Las Vegas 2017 — Modern",
      format: "Modern",
      mainboard: [
        { copies: 4, name: "Signal Pest" },
        { copies: 4, name: "Steel Overseer" },
        { copies: 1, name: "Grafdigger's Cage" }
      ],
      placement: "1st Place",
      player: "Mani Davoudi",
      reportedArchetype: "Affinity",
      sideboard: [
        { copies: 1, name: "Wear // Tear" },
        { copies: 2, name: "Ancient Grudge" }
      ],
      source: "mtggoldfish",
      sourceUrl: "https://www.mtggoldfish.com/deck/677415"
    });
  });

  it("cleans tags, whitespace, and HTML entities", () => {
    expect(cleanText(" <a>Death&#39;s&nbsp;Shadow &amp; Jund</a> ")).toBe("Death's Shadow & Jund");
  });
});
