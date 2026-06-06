import type { DeckCard, RawDeck } from "../types/contracts.js";
import { parseHistoricalDateRange, yearsForHistoricalDateRange } from "../config/historical.js";
import type { CollectorContext, DeckCollector } from "./types.js";

const mtgTop8BaseUrl = "https://www.mtgtop8.com";
const modernFormatUrl = `${mtgTop8BaseUrl}/format?f=MO`;

export type MtgTop8ArchiveEvent = {
  readonly eventId: string;
  readonly eventName: string;
  readonly year: number;
  readonly url: string;
};

export type MtgTop8DeckLink = {
  readonly deckId: string;
  readonly eventId: string;
  readonly reportedArchetype: string;
  readonly player?: string;
  readonly url: string;
};

export const mtgTop8Collector: DeckCollector = {
  async collect(context) {
    if (context.options.allowArchiveDiscovery === "false") {
      context.logger.info("MTGTop8 archive discovery disabled by collection policy.");
      return [];
    }

    const years = parseYears(context.options.years, context);
    const formatPage = await context.snapshotStore.fetchText({
      cacheKey: "modern-format",
      metadata: { kind: "format-archive" },
      refresh: context.refresh,
      source: "mtgtop8",
      url: modernFormatUrl
    });
    const events = applyLimit(
      parseMtgTop8ArchiveEvents(formatPage.body).filter((event) => years.includes(event.year)),
      context.options.limitEvents
    );

    context.logger.info(`MTGTop8 archive events selected: ${events.length} (${years.join(", ")})`);

    const decks: RawDeck[] = [];
    for (const event of events) {
      const eventPage = await context.snapshotStore.fetchText({
        cacheKey: `event-${event.eventId}`,
        metadata: { eventId: event.eventId, eventName: event.eventName, kind: "event" },
        refresh: context.refresh,
        source: "mtgtop8",
        url: event.url
      });
      const deckLinks = applyLimit(parseMtgTop8EventDeckLinks(eventPage.body, event.eventId), context.options.limitDecks);

      for (const deckLink of deckLinks) {
        const deckPage = await context.snapshotStore.fetchText({
          cacheKey: `event-${event.eventId}-deck-${deckLink.deckId}`,
          metadata: { deckId: deckLink.deckId, eventId: event.eventId, kind: "deck" },
          refresh: context.refresh,
          source: "mtgtop8",
          url: deckLink.url
        });
        decks.push(
          parseMtgTop8DeckPage(deckPage.body, {
            fallbackArchetype: deckLink.reportedArchetype,
            fallbackEventName: event.eventName,
            fallbackPlayer: deckLink.player,
            sourceUrl: deckLink.url
          })
        );
      }
    }

    return decks;
  },
  source: "mtgtop8"
};

export function parseMtgTop8ArchiveEvents(html: string): readonly MtgTop8ArchiveEvent[] {
  const events = new Map<string, MtgTop8ArchiveEvent>();
  const optionPattern = /<option\s+value=["']?event\?e=(\d+)&f=MO["']?[^>]*>([^<]*The Decks to Beat[^<]*)<\/option>/gi;
  let match: RegExpExecArray | null;

  while ((match = optionPattern.exec(html)) !== null) {
    const [, eventId, rawEventName] = match;
    if (!eventId || !rawEventName) {
      continue;
    }

    const eventName = decodeHtml(rawEventName);
    const year = inferYear(eventName);
    if (!year) {
      continue;
    }

    events.set(eventId, {
      eventId,
      eventName,
      url: `${mtgTop8BaseUrl}/event?e=${eventId}&f=MO`,
      year
    });
  }

  return [...events.values()].sort((a, b) => a.year - b.year || Number(a.eventId) - Number(b.eventId));
}

export function parseMtgTop8EventDeckLinks(html: string, eventId: string): readonly MtgTop8DeckLink[] {
  const links = new Map<string, MtgTop8DeckLink>();
  const linkPattern =
    /<div\s+class=S14\b[^>]*>\s*<a\s+href=\?e=(\d+)&d=(\d+)&f=MO[^>]*>([\s\S]*?)<\/a>\s*<\/div>\s*<div[^>]*>\s*<a\s+class=player\s+href=search\?player=[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html)) !== null) {
    const [, matchedEventId, deckId, rawArchetype, rawPlayer] = match;
    if (matchedEventId !== eventId || !deckId || !rawArchetype) {
      continue;
    }

    links.set(deckId, {
      deckId,
      eventId,
      player: rawPlayer ? cleanText(rawPlayer) : undefined,
      reportedArchetype: cleanText(rawArchetype),
      url: `${mtgTop8BaseUrl}/event?e=${eventId}&d=${deckId}&f=MO`
    });
  }

  return [...links.values()];
}

export function parseMtgTop8DeckPage(
  html: string,
  options: {
    readonly fallbackArchetype?: string;
    readonly fallbackEventName?: string;
    readonly fallbackPlayer?: string;
    readonly sourceUrl: string;
  }
): RawDeck {
  const title = parseDeckTitle(html);
  const eventName = parseFirstEventTitle(html) ?? options.fallbackEventName;
  const eventDate = parseEventDate(html);
  const reportedArchetype = title?.reportedArchetype ?? options.fallbackArchetype;
  const player = title?.player ?? options.fallbackPlayer;
  const placement = title?.placement;
  const cards = parseDeckCards(html);

  if (cards.mainboard.length === 0) {
    throw new Error(`MTGTop8 deck page has no mainboard cards: ${options.sourceUrl}`);
  }

  return {
    eventDate,
    eventName,
    format: "Modern",
    mainboard: cards.mainboard,
    placement,
    player,
    reportedArchetype,
    sideboard: cards.sideboard,
    source: "mtgtop8",
    sourceUrl: options.sourceUrl
  };
}

function parseDeckCards(html: string): { readonly mainboard: readonly DeckCard[]; readonly sideboard: readonly DeckCard[] } {
  const mainboard: DeckCard[] = [];
  const sideboard: DeckCard[] = [];
  const cardPattern =
    /<div\s+id=(md|sb)[^>]*class=["']deck_line[^"']*["'][^>]*>\s*(\d+)\s*<span[^>]*>([\s\S]*?)<\/span>/gi;
  let match: RegExpExecArray | null;

  while ((match = cardPattern.exec(html)) !== null) {
    const [, zone, copies, rawName] = match;
    if (!zone || !copies || !rawName) {
      continue;
    }

    const card = {
      copies: Number(copies),
      name: cleanText(rawName)
    };

    if (zone === "sb") {
      sideboard.push(card);
    } else {
      mainboard.push(card);
    }
  }

  return { mainboard, sideboard };
}

function parseDeckTitle(
  html: string
): { readonly placement?: string; readonly reportedArchetype?: string; readonly player?: string } | undefined {
  const titlePattern =
    /<div\s+class=event_title>\s*#([^<]+?)\s+([\s\S]*?)\s+-\s+<a\s+class=player_big\s+href=search\?player=[^>]*>([\s\S]*?)<\/a>\s*<\/div>/i;
  const match = titlePattern.exec(html);
  if (!match) {
    return undefined;
  }

  return {
    placement: cleanText(match[1] ?? ""),
    player: cleanText(match[3] ?? ""),
    reportedArchetype: cleanText(match[2] ?? "")
  };
}

function parseFirstEventTitle(html: string): string | undefined {
  const match = /<div\s+class=event_title>(?!#)([\s\S]*?)<\/div>/i.exec(html);
  return match?.[1] ? cleanText(match[1]) : undefined;
}

function parseEventDate(html: string): string | undefined {
  const match = /<div[^>]*style=["'][^"']*margin-bottom:5px;?[^"']*["'][^>]*>\s*(\d{2})\/(\d{2})\/(\d{2})\s*<\/div>/i.exec(
    html
  );
  if (!match) {
    return undefined;
  }

  const [, day, month, shortYear] = match;
  if (!day || !month || !shortYear) {
    return undefined;
  }

  return `20${shortYear}-${month}-${day}`;
}

function parseYears(value: string | undefined, context?: CollectorContext): readonly number[] {
  if (!value) {
    return yearsForHistoricalDateRange(parseHistoricalDateRange({
      endDate: context?.options.endDate,
      startDate: context?.options.startDate
    }));
  }

  const years = value
    .split(",")
    .map((year) => Number(year.trim()))
    .filter((year) => Number.isInteger(year));

  return years.length > 0 ? years : yearsForHistoricalDateRange(parseHistoricalDateRange());
}

function applyLimit<T>(items: readonly T[], limitValue: string | undefined): readonly T[] {
  const limit = limitValue ? Number(limitValue) : undefined;
  if (!limit || !Number.isInteger(limit) || limit < 1) {
    return items;
  }

  return items.slice(0, limit);
}

function inferYear(value: string): number | undefined {
  const match = /'(\d{2})\b/.exec(value);
  if (!match?.[1]) {
    return undefined;
  }

  const shortYear = Number(match[1]);
  return shortYear >= 90 ? 1900 + shortYear : 2000 + shortYear;
}

export function cleanText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&rarr;/g, "->")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}
