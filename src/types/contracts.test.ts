import { describe, expect, it } from "vitest";

import type { NormalizedDeck, RawDeck } from "./contracts.js";

describe("shared contracts", () => {
  it("models raw decklists with source metadata and board zones", () => {
    const deck: RawDeck = {
      format: "Modern",
      mainboard: [{ copies: 4, name: "Lightning Bolt" }],
      sideboard: [{ copies: 2, name: "Ancient Grudge" }],
      source: "mtgtop8",
      sourceUrl: "https://example.test/deck"
    };

    expect(deck.mainboard).toHaveLength(1);
    expect(deck.sideboard[0]?.name).toBe("Ancient Grudge");
  });

  it("models normalized decklists with archetype family, fingerprint, and weight", () => {
    const deck: NormalizedDeck = {
      archetype: "Jund",
      archetypeFamily: "BGx Midrange",
      deckId: "deck-1",
      eventDate: "2015-06-01",
      fingerprint: "abc123",
      mainboard: [{ copies: 4, name: "Tarmogoyf" }],
      sideboard: [],
      source: "mtgo",
      sourceUrl: "https://example.test/deck",
      weight: 1,
      year: 2015
    };

    expect(deck.archetypeFamily).toBe("BGx Midrange");
    expect(deck.weight).toBe(1);
  });
});
