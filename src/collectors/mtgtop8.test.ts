import { describe, expect, it } from "vitest";

import {
  cleanText,
  parseMtgTop8ArchiveEvents,
  parseMtgTop8DeckPage,
  parseMtgTop8EventDeckLinks
} from "./mtgtop8.js";

describe("MTGTop8 parser", () => {
  it("parses Modern Decks to Beat archive events and infers years", () => {
    const events = parseMtgTop8ArchiveEvents(`
      <option value="event?e=17900&f=MO">The Decks to Beat - December '17</option>
      <option value="event?e=14523&f=MO">The Decks to Beat - January '17</option>
      <option value="event?e=8963&f=MO">The Decks to Beat - January '15</option>
      <option value="event?e=123&f=LE">The Decks to Beat - Legacy '15</option>
    `);

    expect(events).toEqual([
      {
        eventId: "8963",
        eventName: "The Decks to Beat - January '15",
        url: "https://www.mtgtop8.com/event?e=8963&f=MO",
        year: 2015
      },
      {
        eventId: "14523",
        eventName: "The Decks to Beat - January '17",
        url: "https://www.mtgtop8.com/event?e=14523&f=MO",
        year: 2017
      },
      {
        eventId: "17900",
        eventName: "The Decks to Beat - December '17",
        url: "https://www.mtgtop8.com/event?e=17900&f=MO",
        year: 2017
      }
    ]);
  });

  it("parses event deck links with archetype and player", () => {
    const links = parseMtgTop8EventDeckLinks(
      `
      <div style="width:80px"><a href=?e=8963&d=251100&f=MO><img src=/metas_thumbs/189.jpg></a></div>
      <div class=S14><a href=?e=8963&d=251100&f=MO>Affinity</a></div>
      <div class=G11><a class=player href=search?player=Joe+Fasano>Joe Fasano</a></div>
      <div style="width:80px"><a href=?e=8963&d=251105&f=MO><img src=/metas_thumbs/190.jpg></a></div>
      <div class=S14><a href=?e=8963&d=251105&f=MO>Twin Exarch</a></div>
      <div class=G11><a class=player href=search?player=B4dA1r>B4dA1r</a></div>
    `,
      "8963"
    );

    expect(links).toEqual([
      {
        deckId: "251100",
        eventId: "8963",
        player: "Joe Fasano",
        reportedArchetype: "Affinity",
        url: "https://www.mtgtop8.com/event?e=8963&d=251100&f=MO"
      },
      {
        deckId: "251105",
        eventId: "8963",
        player: "B4dA1r",
        reportedArchetype: "Twin Exarch",
        url: "https://www.mtgtop8.com/event?e=8963&d=251105&f=MO"
      }
    ]);
  });

  it("parses deck metadata and separates mainboard from sideboard", () => {
    const deck = parseMtgTop8DeckPage(
      `
      <div class=event_title>The Decks to Beat - January '15</div>
      <div class=event_title>#9-16 Abzan Control - <a class=player_big href=search?player=esquilo>esquilo</a></div>
      <div style="margin-bottom:5px;">22/01/15</div>
      <div id=mdktk161 class="deck_line hover_tr" onclick="AffCard('ktk161','Abzan+Charm','','');">4 <span class=L14>Abzan Charm</span> </div>
      <div id=mdths090 class="deck_line hover_tr" onclick="AffCard('ths090','Hero\\'s+Downfall','','');">3 <span class=L14>Hero&#039;s Downfall</span> </div>
      <div class=O14>SIDEBOARD</div>
      <div id=sbbng065 class="deck_line hover_tr" onclick="AffCard('bng065','Drown+in+Sorrow','','');">3 <span class=L14>Drown in Sorrow</span> </div>
      <div id=sb15m187 class="deck_line hover_tr" onclick="AffCard('15m187','Nissa,+Worldwaker','','');">1 <span class=L14>Nissa, Worldwaker</span> </div>
    `,
      {
        sourceUrl: "https://www.mtgtop8.com/event?e=8963&d=251179&f=MO"
      }
    );

    expect(deck).toEqual({
      eventDate: "2015-01-22",
      eventName: "The Decks to Beat - January '15",
      format: "Modern",
      mainboard: [
        { copies: 4, name: "Abzan Charm" },
        { copies: 3, name: "Hero's Downfall" }
      ],
      placement: "9-16",
      player: "esquilo",
      reportedArchetype: "Abzan Control",
      sideboard: [
        { copies: 3, name: "Drown in Sorrow" },
        { copies: 1, name: "Nissa, Worldwaker" }
      ],
      source: "mtgtop8",
      sourceUrl: "https://www.mtgtop8.com/event?e=8963&d=251179&f=MO"
    });
  });

  it("cleans tags, whitespace, and common HTML entities", () => {
    expect(cleanText("  <span>Death&#039;s&nbsp;Shadow &amp; Burn</span> ")).toBe("Death's Shadow & Burn");
  });
});
