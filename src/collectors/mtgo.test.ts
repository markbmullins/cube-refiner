import { describe, expect, it } from "vitest";

import { extractMtgoDecklistData, parseMtgoDecklistIndex, parseMtgoDecklistPage } from "./mtgo.js";

describe("MTGO parser", () => {
  it("parses Modern decklist links from the month index", () => {
    const items = parseMtgoDecklistIndex(`
      <li class="decklists-item">
        <a href="/decklist/modern-league-2026-06-0510628" class="decklists-link">
          <div class="decklists-details"><h3>Modern League</h3></div>
          <time datetime="2026-06-05T00:00:00Z" class="decklists-date"></time>
        </a>
      </li>
      <li class="decklists-item">
        <a href="/decklist/pioneer-league-2026-06-0510644" class="decklists-link">
          <div class="decklists-details"><h3>Pioneer League</h3></div>
          <time datetime="2026-06-05T00:00:00Z" class="decklists-date"></time>
        </a>
      </li>
      <li class="decklists-item">
        <a href="/decklist/modern-challenge-64-2026-06-0412843768" class="decklists-link">
          <div class="decklists-details"><h3>Modern Challenge 64</h3></div>
          <time datetime="2026-06-04T13:00:00Z" class="decklists-date"></time>
        </a>
      </li>
    `);

    expect(items).toEqual([
      {
        publishedAt: "2026-06-05T00:00:00Z",
        title: "Modern League",
        url: "https://www.mtgo.com/decklist/modern-league-2026-06-0510628"
      },
      {
        publishedAt: "2026-06-04T13:00:00Z",
        title: "Modern Challenge 64",
        url: "https://www.mtgo.com/decklist/modern-challenge-64-2026-06-0412843768"
      }
    ]);
  });

  it("extracts the embedded MTGO decklist JSON payload", () => {
    const data = extractMtgoDecklistData(`
      <script>
      window.MTGO.decklists = window.MTGO.decklists || {};
      window.MTGO.decklists.data = {"name":"Modern League","publish_date":"2026-05-12","decklists":[]};
      window.MTGO.decklists.type = 'league';
      </script>
    `);

    expect(data).toEqual({
      decklists: [],
      name: "Modern League",
      publish_date: "2026-05-12"
    });
  });

  it("maps embedded league decklists into RawDeck records", () => {
    const decks = parseMtgoDecklistPage(
      `
      <script>
      window.MTGO.decklists = window.MTGO.decklists || {};
      window.MTGO.decklists.data = {
        "name":"Modern League",
        "publish_date":"2026-05-12",
        "decklists":[{
          "loginplayeventcourseid":"34973742",
          "player":"Dumpring",
          "main_deck":[
            {"qty":"4","card_attributes":{"card_name":"Mind Stone"}},
            {"qty":"3","card_attributes":{"card_name":"Dismember"}}
          ],
          "sideboard_deck":[
            {"qty":"1","card_attributes":{"card_name":"The Stone Brain"}},
            {"qty":"2","card_attributes":{"card_name":"Torpor Orb"}}
          ],
          "wins":{"wins":"5","losses":"0"}
        }]
      };
      window.MTGO.decklists.type = 'league';
      </script>
    `,
      "https://www.mtgo.com/decklist/modern-league-2026-05-1210628"
    );

    expect(decks).toEqual([
      {
        eventDate: "2026-05-12",
        eventName: "Modern League",
        format: "Modern",
        mainboard: [
          { copies: 4, name: "Mind Stone" },
          { copies: 3, name: "Dismember" }
        ],
        placement: "5-0",
        player: "Dumpring",
        sideboard: [
          { copies: 1, name: "The Stone Brain" },
          { copies: 2, name: "Torpor Orb" }
        ],
        source: "mtgo",
        sourceUrl: "https://www.mtgo.com/decklist/modern-league-2026-05-1210628#34973742"
      }
    ]);
  });

  it("uses tournament standings or final rank as placement when win/loss is absent", () => {
    const decks = parseMtgoDecklistPage(
      `
      <script>
      window.MTGO.decklists.data = {
        "description":"Modern Challenge 64",
        "starttime":"2026-04-09 13:00:00.0",
        "decklists":[{
          "loginid":"535716",
          "decktournamentid":"58509857",
          "player":"Capitano_CL",
          "main_deck":[{"qty":"1","card_attributes":{"card_name":"Lightning Bolt"}}],
          "sideboard_deck":[]
        }],
        "final_rank":[{"loginid":"535716","rank":"11"}]
      };
      window.MTGO.decklists.type = 'tournament';
      </script>
    `,
      "https://www.mtgo.com/decklist/modern-challenge-64-2026-04-0912838854"
    );

    expect(decks[0]?.placement).toBe("#11");
    expect(decks[0]?.eventDate).toBe("2026-04-09");
  });
});
