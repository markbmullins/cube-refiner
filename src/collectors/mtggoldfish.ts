import type { DeckCard, RawDeck } from "../types/contracts.js";
import { parseHistoricalDateRange, yearsForHistoricalDateRange } from "../config/historical.js";
import type { CollectorContext, DeckCollector } from "./types.js";

const mtgGoldfishBaseUrl = "https://www.mtggoldfish.com";
const defaultTournamentUrls = [
  `${mtgGoldfishBaseUrl}/tournament/grand-prix-las-vegas-2017-modern`,
  `${mtgGoldfishBaseUrl}/tournament/23447`
] as const;
const defaultYears = [2013, 2014, 2015, 2016, 2017] as const;

export type MtgGoldfishTournamentMetadata = {
  readonly eventDate?: string;
  readonly eventId?: string;
  readonly eventName?: string;
  readonly format?: string;
  readonly sourceUrl: string;
};

export type MtgGoldfishDeckLink = {
  readonly deckId: string;
  readonly player?: string;
  readonly placement?: string;
  readonly reportedArchetype: string;
  readonly url: string;
};

export const mtgGoldfishCollector: DeckCollector = {
  async collect(context) {
    if (context.options.allowArchiveDiscovery === "false" && !context.options.events) {
      context.logger.info("MTGGoldfish default tournament discovery disabled by collection policy.");
      return [];
    }

    const years = parseYears(context.options.years, context);
    const tournamentUrls = applyLimit(parseTournamentInputs(context.options.events), context.options.limitEvents);
    context.logger.info(`MTGGoldfish tournament pages selected: ${tournamentUrls.length}`);

    const decks: RawDeck[] = [];
    for (const tournamentUrl of tournamentUrls) {
      const tournamentPage = await context.snapshotStore.fetchText({
        cacheKey: tournamentCacheKey(tournamentUrl),
        metadata: { kind: "tournament" },
        refresh: context.refresh,
        source: "mtggoldfish",
        url: tournamentUrl
      });
      const metadata = parseMtgGoldfishTournamentMetadata(tournamentPage.body, tournamentUrl);
      if (metadata.eventDate && !years.includes(Number(metadata.eventDate.slice(0, 4)))) {
        continue;
      }

      const deckLinks = applyLimit(parseMtgGoldfishTournamentDeckLinks(tournamentPage.body), context.options.limitDecks);
      for (const deckLink of deckLinks) {
        const deckPage = await context.snapshotStore.fetchText({
          cacheKey: `deck-${deckLink.deckId}`,
          metadata: {
            deckId: deckLink.deckId,
            eventDate: metadata.eventDate,
            eventId: metadata.eventId,
            eventName: metadata.eventName,
            kind: "deck",
            parserNotes: ["prefers deck_input hidden text to preserve displayed split-card punctuation"]
          },
          refresh: context.refresh,
          source: "mtggoldfish",
          url: deckLink.url
        });
        decks.push(
          parseMtgGoldfishDeckPage(deckPage.body, {
            fallbackEventDate: metadata.eventDate,
            fallbackEventName: metadata.eventName,
            fallbackPlacement: deckLink.placement,
            fallbackPlayer: deckLink.player,
            fallbackReportedArchetype: deckLink.reportedArchetype,
            sourceUrl: deckLink.url
          })
        );
      }
    }

    return decks;
  },
  source: "mtggoldfish"
};

export function parseMtgGoldfishTournamentMetadata(
  html: string,
  sourceUrl: string
): MtgGoldfishTournamentMetadata {
  const eventId = /\/tournament\/([^"'?#/]+)/i.exec(sourceUrl)?.[1];
  const eventName =
    cleanText(/<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1] ?? "") ||
    cleanText(/<title>([\s\S]*?)(?:\s+\(Modern\)\s+Decks)?<\/title>/i.exec(html)?.[1] ?? "") ||
    undefined;
  const format = cleanText(/Format:\s*([^<\n]+)/i.exec(html)?.[1] ?? "") || undefined;
  const eventDate = normalizeDate(cleanText(/Date:\s*([A-Za-z0-9,\-\s]+)/i.exec(html)?.[1] ?? ""));

  return {
    eventDate,
    eventId,
    eventName,
    format,
    sourceUrl
  };
}

export function parseMtgGoldfishTournamentDeckLinks(html: string): readonly MtgGoldfishDeckLink[] {
  const links = new Map<string, MtgGoldfishDeckLink>();
  const rowPattern = /<tr\s+class=['"]tournament-decklist-event['"][^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const row = rowMatch[1] ?? "";
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1] ?? "");
    const deckLink = /<a\s+href=["']\/deck\/(\d+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(cells[1] ?? row);
    if (!deckLink?.[1] || !deckLink[2]) {
      continue;
    }

    const deckId = deckLink[1];
    links.set(deckId, {
      deckId,
      placement: cleanText(cells[0] ?? "") || undefined,
      player: cleanText(cells[2] ?? "") || undefined,
      reportedArchetype: cleanText(deckLink[2]),
      url: `${mtgGoldfishBaseUrl}/deck/${deckId}`
    });
  }

  return [...links.values()];
}

export function parseMtgGoldfishDeckPage(
  html: string,
  options: {
    readonly fallbackEventDate?: string;
    readonly fallbackEventName?: string;
    readonly fallbackPlacement?: string;
    readonly fallbackPlayer?: string;
    readonly fallbackReportedArchetype?: string;
    readonly sourceUrl: string;
  }
): RawDeck {
  const header = parseDeckHeader(html);
  const info = parseDeckInfo(html);
  const cards = parseMtgGoldfishDeckText(extractDeckText(html));

  if (cards.mainboard.length === 0) {
    throw new Error(`MTGGoldfish deck page has no mainboard cards: ${options.sourceUrl}`);
  }

  return {
    eventDate: info.eventDate ?? options.fallbackEventDate,
    eventName: info.eventName ?? options.fallbackEventName,
    format: "Modern",
    mainboard: cards.mainboard,
    placement: info.placement ?? options.fallbackPlacement,
    player: header.player ?? options.fallbackPlayer,
    reportedArchetype: header.reportedArchetype ?? options.fallbackReportedArchetype,
    sideboard: cards.sideboard,
    source: "mtggoldfish",
    sourceUrl: options.sourceUrl
  };
}

export function parseMtgGoldfishDeckText(
  text: string
): { readonly mainboard: readonly DeckCard[]; readonly sideboard: readonly DeckCard[] } {
  const mainboard: DeckCard[] = [];
  const sideboard: DeckCard[] = [];
  let zone: "mainboard" | "sideboard" = "mainboard";
  let sawBlankLine = false;
  let sawMainboardCard = false;

  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) {
      sawBlankLine = sawMainboardCard;
      continue;
    }

    if (/^sideboard$/i.test(line)) {
      zone = "sideboard";
      continue;
    }

    const match = /^(\d+)\s+(.+)$/.exec(line);
    if (!match?.[1] || !match[2]) {
      continue;
    }

    if (sawBlankLine && zone === "mainboard") {
      zone = "sideboard";
    }

    const card = {
      copies: Number(match[1]),
      name: cleanText(match[2])
    };

    if (zone === "sideboard") {
      sideboard.push(card);
    } else {
      mainboard.push(card);
      sawMainboardCard = true;
    }
  }

  return { mainboard, sideboard };
}

function parseDeckHeader(
  html: string
): { readonly player?: string; readonly reportedArchetype?: string } {
  const match =
    /<h1\s+class=['"]title['"][^>]*>\s*([\s\S]*?)\s*<span\s+class=['"]author['"][^>]*>\s*by\s*([\s\S]*?)<\/span>\s*<\/h1>/i.exec(
      html
    );

  if (!match) {
    return {};
  }

  return {
    player: cleanText(match[2] ?? "") || undefined,
    reportedArchetype: cleanText(match[1] ?? "") || undefined
  };
}

function parseDeckInfo(
  html: string
): { readonly eventDate?: string; readonly eventName?: string; readonly placement?: string } {
  const info = /<p\s+class=['"]deck-container-information['"][^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1] ?? "";
  const eventMatch = /Event:\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*,?\s*([^<\n]*)/i.exec(info);

  return {
    eventDate: normalizeDate(cleanText(/Deck Date:\s*([^<\n]+)/i.exec(info)?.[1] ?? "")),
    eventName: eventMatch?.[1] ? cleanText(eventMatch[1]) : undefined,
    placement: eventMatch?.[2] ? cleanText(eventMatch[2]) : undefined
  };
}

function extractDeckText(html: string): string {
  const inputPattern =
    /<input\b(?=[^>]*\bname=["']deck_input\[deck\]["'])(?=[^>]*\bvalue=["'])([^>]*)>/i;
  const input = inputPattern.exec(html)?.[1];
  if (!input) {
    throw new Error("Could not find MTGGoldfish deck_input deck text.");
  }

  const valueMatch = /\bvalue=(["'])([\s\S]*?)\1/i.exec(input);
  if (!valueMatch?.[2]) {
    throw new Error("Could not extract MTGGoldfish deck_input value.");
  }

  return decodeHtml(valueMatch[2]);
}

function parseTournamentInputs(value: string | undefined): readonly string[] {
  const inputs = value
    ? value
        .split(",")
        .map((input) => input.trim())
        .filter((input) => input.length > 0)
    : [...defaultTournamentUrls];

  return inputs.map((input) => {
    if (input.startsWith("http")) {
      return input;
    }

    return `${mtgGoldfishBaseUrl}/tournament/${input.replace(/^\/?tournament\//, "")}`;
  });
}

function parseYears(value: string | undefined, context?: CollectorContext): readonly number[] {
  if (!value) {
    return context ? yearsForHistoricalDateRange(parseHistoricalDateRange({
      endDate: context.options.endDate,
      startDate: context.options.startDate
    })) : [...defaultYears];
  }

  const years = value
    .split(",")
    .map((year) => Number(year.trim()))
    .filter((year) => Number.isInteger(year));

  return years.length > 0 ? years : [...defaultYears];
}

function applyLimit<T>(items: readonly T[], limitValue: string | undefined): readonly T[] {
  const limit = limitValue ? Number(limitValue) : undefined;
  if (!limit || !Number.isInteger(limit) || limit < 1) {
    return items;
  }

  return items.slice(0, limit);
}

function tournamentCacheKey(url: string): string {
  return `tournament-${url.replace(`${mtgGoldfishBaseUrl}/tournament/`, "")}`;
}

function normalizeDate(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const namedMatch = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(value);
  if (!namedMatch?.[1] || !namedMatch[2] || !namedMatch[3]) {
    return undefined;
  }

  const month = monthNumber(namedMatch[1]);
  if (!month) {
    return undefined;
  }

  return `${namedMatch[3]}-${month}-${namedMatch[2].padStart(2, "0")}`;
}

function monthNumber(value: string): string | undefined {
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december"
  ];
  const normalized = value.toLowerCase();
  const month = months.findIndex((candidate) => candidate === normalized || candidate.slice(0, 3) === normalized);

  return month === -1 ? undefined : String(month + 1).padStart(2, "0");
}

export function cleanText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&rarr;/g, "->")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}
