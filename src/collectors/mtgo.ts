import type { DeckCard, RawDeck } from "../types/contracts.js";
import { monthsForHistoricalDateRange, parseHistoricalDateRange, yearsForHistoricalDateRange } from "../config/historical.js";
import type { CollectorContext, DeckCollector } from "./types.js";

const mtgoBaseUrl = "https://www.mtgo.com";
const defaultYears = [2015, 2016, 2017] as const;
const allMonths = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"] as const;

export type MtgoDecklistIndexItem = {
  readonly title: string;
  readonly publishedAt?: string;
  readonly url: string;
};

type MtgoCardRow = {
  readonly qty?: string | number;
  readonly card_attributes?: {
    readonly card_name?: string;
  };
};

type MtgoDeckRow = {
  readonly decktournamentid?: string;
  readonly loginid?: string;
  readonly loginplayeventcourseid?: string;
  readonly main_deck?: readonly MtgoCardRow[];
  readonly player?: string;
  readonly sideboard_deck?: readonly MtgoCardRow[];
  readonly wins?: {
    readonly wins?: string | number;
    readonly losses?: string | number;
  };
};

type MtgoDecklistData = {
  readonly decklists?: readonly MtgoDeckRow[];
  readonly description?: string;
  readonly event_id?: string;
  readonly final_rank?: readonly { readonly loginid?: string | number; readonly rank?: string | number }[];
  readonly name?: string;
  readonly publish_date?: string;
  readonly standings?: readonly { readonly loginid?: string | number; readonly rank?: string | number }[];
  readonly starttime?: string;
};

export const mtgoCollector: DeckCollector = {
  async collect(context) {
    if (context.options.allowArchiveDiscovery === "false") {
      context.logger.info("MTGO archive discovery disabled by collection policy.");
      return [];
    }

    const years = parseYears(context.options.years, context);
    const indexItems: MtgoDecklistIndexItem[] = [];

    for (const year of years) {
      const months = parseMonths(context.options.months, context, year);
      for (const month of months) {
        if (year === 2015 && Number(month) < 11) {
          continue;
        }

        const url = `${mtgoBaseUrl}/decklists/${year}/${month}`;
        const indexPage = await context.snapshotStore.fetchText({
          cacheKey: `decklists-${year}-${month}-modern`,
          metadata: { kind: "decklists-index", month, year },
          refresh: context.refresh,
          source: "mtgo",
          url
        });
        indexItems.push(...parseMtgoDecklistIndex(indexPage.body));
      }
    }

    const selectedItems = applyLimit(dedupeIndexItems(indexItems), context.options.limitEvents);
    context.logger.info(`MTGO Modern decklist pages selected: ${selectedItems.length}`);

    const decks: RawDeck[] = [];
    for (const item of selectedItems) {
      const page = await context.snapshotStore.fetchText({
        cacheKey: item.url.replace(`${mtgoBaseUrl}/decklist/`, "decklist-"),
        metadata: { kind: "decklist", title: item.title },
        refresh: context.refresh,
        source: "mtgo",
        url: item.url
      });
      decks.push(...applyLimit(parseMtgoDecklistPage(page.body, item.url), context.options.limitDecks));
    }

    return decks;
  },
  source: "mtgo"
};

export function parseMtgoDecklistIndex(html: string): readonly MtgoDecklistIndexItem[] {
  const items: MtgoDecklistIndexItem[] = [];
  const itemPattern =
    /<a\s+href="([^"]*\/decklist\/modern-[^"]+)"\s+class="decklists-link">[\s\S]*?<h3>([\s\S]*?)<\/h3>[\s\S]*?<time\s+datetime="([^"]+)"/gi;
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(html)) !== null) {
    const [, rawHref, rawTitle, publishedAt] = match;
    if (!rawHref || !rawTitle) {
      continue;
    }

    items.push({
      publishedAt,
      title: cleanHtmlText(rawTitle),
      url: absoluteMtgoUrl(rawHref)
    });
  }

  return items;
}

export function parseMtgoDecklistPage(html: string, sourceUrl: string): readonly RawDeck[] {
  const data = extractMtgoDecklistData(html);
  const eventName = data.name ?? data.description;
  const eventDate = normalizeDate(data.publish_date ?? data.starttime);
  const placementByLoginId = buildPlacementLookup(data);

  return (data.decklists ?? []).map((deck) => {
    const deckId = deck.loginplayeventcourseid ?? deck.decktournamentid ?? deck.loginid ?? deck.player ?? "deck";
    const player = deck.player;
    const placement = formatPlacement(deck, placementByLoginId);

    return {
      eventDate,
      eventName,
      format: "Modern",
      mainboard: mapMtgoCards(deck.main_deck ?? []),
      placement,
      player,
      sideboard: mapMtgoCards(deck.sideboard_deck ?? []),
      source: "mtgo",
      sourceUrl: `${sourceUrl}#${encodeURIComponent(deckId)}`
    };
  });
}

export function extractMtgoDecklistData(html: string): MtgoDecklistData {
  const match = /window\.MTGO\.decklists\.data\s*=\s*(\{[\s\S]*?\});\s*(?:window\.MTGO\.decklists\.type|<\/script>)/.exec(
    html
  );
  if (!match?.[1]) {
    throw new Error("Could not find MTGO decklist JSON payload.");
  }

  return JSON.parse(match[1]) as MtgoDecklistData;
}

function mapMtgoCards(cards: readonly MtgoCardRow[]): readonly DeckCard[] {
  return cards
    .map((card) => ({
      copies: Number(card.qty ?? 0),
      name: card.card_attributes?.card_name?.trim() ?? ""
    }))
    .filter((card) => card.copies > 0 && card.name.length > 0);
}

function buildPlacementLookup(data: MtgoDecklistData): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();

  for (const row of data.final_rank ?? data.standings ?? []) {
    if (row.loginid !== undefined && row.rank !== undefined) {
      lookup.set(String(row.loginid), String(row.rank));
    }
  }

  return lookup;
}

function formatPlacement(deck: MtgoDeckRow, placementByLoginId: ReadonlyMap<string, string>): string | undefined {
  if (deck.wins?.wins !== undefined && deck.wins.losses !== undefined) {
    return `${deck.wins.wins}-${deck.wins.losses}`;
  }

  if (deck.loginid !== undefined) {
    const rank = placementByLoginId.get(String(deck.loginid));
    return rank ? `#${rank}` : undefined;
  }

  return undefined;
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
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

function parseMonths(value: string | undefined, context?: CollectorContext, year?: number): readonly string[] {
  if (!value && context && year !== undefined) {
    return monthsForHistoricalDateRange(parseHistoricalDateRange({
      endDate: context.options.endDate,
      startDate: context.options.startDate
    }), year);
  }
  if (!value) {
    return [...allMonths];
  }

  const months = value
    .split(",")
    .map((month) => month.trim().padStart(2, "0"))
    .filter((month) => allMonths.includes(month as (typeof allMonths)[number]));

  return months.length > 0 ? months : [...allMonths];
}

function applyLimit<T>(items: readonly T[], limitValue: string | undefined): readonly T[] {
  const limit = limitValue ? Number(limitValue) : undefined;
  if (!limit || !Number.isInteger(limit) || limit < 1) {
    return items;
  }

  return items.slice(0, limit);
}

function dedupeIndexItems(items: readonly MtgoDecklistIndexItem[]): readonly MtgoDecklistIndexItem[] {
  return [...new Map(items.map((item) => [item.url, item])).values()];
}

function absoluteMtgoUrl(value: string): string {
  if (value.startsWith("http")) {
    return value;
  }

  return `${mtgoBaseUrl}${value.startsWith("/") ? "" : "/"}${value}`;
}

function cleanHtmlText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}
