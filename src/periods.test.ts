import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigrations, listManualReviewItems, openDatabase } from "./db/index.js";
import {
  listDeckMetagamePeriodAssignments,
  listMetagamePeriodAssignmentReviews,
  listMetagamePeriods,
  replaceSetReleases,
  upsertNormalizedDeck
} from "./db/repository.js";
import {
  assignDecksToMetagamePeriods,
  generateAndPersistMetagamePeriods,
  generateMetagamePeriods
} from "./periods.js";
import type { SetRelease } from "./types/contracts.js";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("historical metagame periods", () => {
  it("generates Standard set release windows clipped to configured dates", () => {
    const periods = generateMetagamePeriods(testReleases, {
      endDate: "2012-02-02",
      startDate: "2011-08-12"
    });

    expect(periods).toEqual([
      {
        endDate: "2011-09-29",
        model: "standard_set_release",
        periodId: "standard_set_release_m12_2011-08-12",
        releaseDate: "2011-07-15",
        setCode: "m12",
        setName: "Magic 2012",
        sortOrder: 0,
        startDate: "2011-08-12"
      },
      {
        endDate: "2012-02-02",
        model: "standard_set_release",
        periodId: "standard_set_release_isd_2011-09-30",
        releaseDate: "2011-09-30",
        setCode: "isd",
        setName: "Innistrad",
        sortOrder: 1,
        startDate: "2011-09-30"
      }
    ]);
  });

  it("persists periods and assigns decks deterministically by event date", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    replaceSetReleases(database, testReleases);
    generateAndPersistMetagamePeriods(database, {
      endDate: "2012-02-02",
      startDate: "2011-08-12"
    });

    upsertTestDeck(database, "before-start", "2011-08-11");
    upsertTestDeck(database, "first-day", "2011-08-12");
    upsertTestDeck(database, "day-before-next", "2011-09-29");
    upsertTestDeck(database, "exact-release", "2011-09-30");
    upsertTestDeck(database, "configured-end", "2012-02-02");
    upsertTestDeck(database, "after-end", "2012-02-03");

    const summary = assignDecksToMetagamePeriods(database);

    expect(summary).toEqual({
      assignedDecks: 4,
      reviewRows: 2
    });
    expect(listMetagamePeriods(database).map((period) => period.periodId)).toEqual([
      "standard_set_release_m12_2011-08-12",
      "standard_set_release_isd_2011-09-30"
    ]);
    expect(
      listDeckMetagamePeriodAssignments(database).map((assignment) => ({
        deckId: assignment.deckId,
        periodId: assignment.periodId
      }))
    ).toEqual([
      {
        deckId: "configured-end",
        periodId: "standard_set_release_isd_2011-09-30"
      },
      {
        deckId: "day-before-next",
        periodId: "standard_set_release_m12_2011-08-12"
      },
      {
        deckId: "exact-release",
        periodId: "standard_set_release_isd_2011-09-30"
      },
      {
        deckId: "first-day",
        periodId: "standard_set_release_m12_2011-08-12"
      }
    ]);
    expect(listMetagamePeriodAssignmentReviews(database).map((review) => review.deckId)).toEqual([
      "before-start",
      "after-end"
    ]);
    expect(listManualReviewItems(database, "period_assignments")).toHaveLength(2);
  });
});

const testReleases: readonly SetRelease[] = [
  {
    releaseDate: "2011-07-15",
    setCode: "m12",
    setName: "Magic 2012",
    setType: "core",
    source: "test"
  },
  {
    releaseDate: "2011-09-30",
    setCode: "isd",
    setName: "Innistrad",
    setType: "expansion",
    source: "test"
  },
  {
    releaseDate: "2012-02-03",
    setCode: "dka",
    setName: "Dark Ascension",
    setType: "expansion",
    source: "test"
  }
];

function upsertTestDeck(database: DatabaseSync, deckId: string, eventDate: string): void {
  upsertNormalizedDeck(database, {
    archetype: "Jund",
    archetypeFamily: "BGx Midrange",
    deckId,
    eventDate,
    fingerprint: `fingerprint-${deckId}`,
    mainboard: [{ copies: 4, name: "Lightning Bolt" }],
    sideboard: [],
    source: "mtgo",
    sourceUrl: `https://example.test/${deckId}`,
    weight: 1,
    year: Number(eventDate.slice(0, 4))
  });
}
