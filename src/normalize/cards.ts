import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  listCanonicalCardNames,
  listCardNameMappings,
  listRawDeckCardRecords,
  listRawDeckRecords,
  upsertCard,
  upsertCardNameMapping,
  upsertNormalizedDeck
} from "../db/index.js";
import type { CardInput, RawDeckCardRecord, RawDeckRecord } from "../db/repository.js";
import type { DeckCard, NormalizedDeck } from "../types/contracts.js";

const scryfallBulkDataUrl = "https://api.scryfall.com/bulk-data/default-cards";

export type ScryfallCard = {
  readonly id?: string;
  readonly name?: string;
  readonly colors?: readonly string[];
  readonly color_identity?: readonly string[];
  readonly type_line?: string;
  readonly cmc?: number;
  readonly digital?: boolean;
  readonly layout?: string;
};

export type NormalizeCardsOptions = {
  readonly auditCsvPath?: string;
  readonly failOnUnknown?: boolean;
};

export type CardNormalizationAuditRow = {
  readonly rawName: string;
  readonly canonicalName?: string;
  readonly status: "mapped" | "unresolved";
};

export type NormalizeCardsSummary = {
  readonly auditCsvPath?: string;
  readonly mappedNames: number;
  readonly normalizedDecks: number;
  readonly unresolvedNames: number;
};

export async function fetchAndImportScryfallDefaultCards(
  database: DatabaseSync,
  fetcher: typeof fetch = fetch
): Promise<number> {
  const metadataResponse = await fetcher(scryfallBulkDataUrl);
  if (!metadataResponse.ok) {
    throw new Error(`Failed to fetch Scryfall bulk metadata: HTTP ${metadataResponse.status}`);
  }

  const metadata = (await metadataResponse.json()) as { readonly download_uri?: string };
  if (!metadata.download_uri) {
    throw new Error("Scryfall bulk metadata did not include download_uri.");
  }

  const cardsResponse = await fetcher(metadata.download_uri);
  if (!cardsResponse.ok) {
    throw new Error(`Failed to fetch Scryfall default cards: HTTP ${cardsResponse.status}`);
  }

  return importScryfallCards(database, (await cardsResponse.json()) as readonly ScryfallCard[]);
}

export function importScryfallCardsFromFile(database: DatabaseSync, filePath: string): number {
  return importScryfallCards(database, JSON.parse(readFileSync(filePath, "utf8")) as readonly ScryfallCard[]);
}

export function importScryfallCards(database: DatabaseSync, cards: readonly ScryfallCard[]): number {
  let imported = 0;

  for (const card of cards) {
    if (!card.name || isUnwantedScryfallCard(card)) {
      continue;
    }

    upsertCard(database, scryfallCardToInput(card));
    imported += 1;
  }

  return imported;
}

export function normalizeCards(database: DatabaseSync, options: NormalizeCardsOptions = {}): NormalizeCardsSummary {
  const resolver = createCardNameResolver(listCanonicalCardNames(database), listCardNameMappings(database));
  const rawDecks = listRawDeckRecords(database);
  const auditByRawName = new Map<string, CardNormalizationAuditRow>();
  let normalizedDecks = 0;

  for (const rawDeck of rawDecks) {
    const rawCards = listRawDeckCardRecords(database, rawDeck.id);
    const normalizedMainboard = normalizeDeckCards(database, resolver, rawDeck, rawCards, "mainboard", auditByRawName);
    const normalizedSideboard = normalizeDeckCards(database, resolver, rawDeck, rawCards, "sideboard", auditByRawName);

    if (normalizedMainboard.unresolved.length > 0 || normalizedSideboard.unresolved.length > 0) {
      continue;
    }

    upsertNormalizedDeck(database, buildNormalizedDeck(rawDeck, normalizedMainboard.cards, normalizedSideboard.cards));
    normalizedDecks += 1;
  }

  const auditRows = [...auditByRawName.values()].sort((a, b) => a.rawName.localeCompare(b.rawName));
  if (options.auditCsvPath) {
    writeAuditCsv(options.auditCsvPath, auditRows);
  }

  const unresolvedRows = auditRows.filter((row) => row.status === "unresolved");
  if (options.failOnUnknown === true && unresolvedRows.length > 0) {
    throw new Error(`Unresolved card names: ${unresolvedRows.map((row) => row.rawName).join(", ")}`);
  }

  return {
    auditCsvPath: options.auditCsvPath,
    mappedNames: auditRows.length - unresolvedRows.length,
    normalizedDecks,
    unresolvedNames: unresolvedRows.length
  };
}

export function createCardNameResolver(
  canonicalCardNames: readonly string[],
  mappings: readonly { readonly rawName: string; readonly canonicalName?: string; readonly status: string }[] = []
): (rawName: string) => string | undefined {
  const canonicalByKey = new Map<string, string>();
  for (const canonicalName of canonicalCardNames) {
    for (const key of cardNameKeys(canonicalName)) {
      canonicalByKey.set(key, canonicalName);
    }
  }

  for (const mapping of mappings) {
    if (mapping.status !== "mapped" || !mapping.canonicalName) {
      continue;
    }

    for (const key of cardNameKeys(mapping.rawName)) {
      canonicalByKey.set(key, mapping.canonicalName);
    }
  }

  return (rawName) => canonicalByKey.get(primaryCardNameKey(rawName));
}

export function cardNameKeys(value: string): readonly string[] {
  const primary = primaryCardNameKey(value);
  const slashCollapsed = primaryCardNameKey(value.replace(/\s*\/\/\s*/g, "/"));
  const noSlash = primaryCardNameKey(value.replace(/\s*\/\/?\s*/g, " "));

  return [...new Set([primary, slashCollapsed, noSlash])];
}

export function primaryCardNameKey(value: string): string {
  return decodeHtml(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
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
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function normalizeDeckCards(
  database: DatabaseSync,
  resolver: (rawName: string) => string | undefined,
  rawDeck: RawDeckRecord,
  rawCards: readonly RawDeckCardRecord[],
  zone: "mainboard" | "sideboard",
  auditByRawName: Map<string, CardNormalizationAuditRow>
): { readonly cards: readonly DeckCard[]; readonly unresolved: readonly string[] } {
  const cards: DeckCard[] = [];
  const unresolved: string[] = [];

  for (const card of rawCards.filter((candidate) => candidate.zone === zone)) {
    const canonicalName = resolver(card.name);
    if (!canonicalName) {
      unresolved.push(card.name);
      auditByRawName.set(card.name, {
        rawName: card.name,
        status: "unresolved"
      });
      upsertCardNameMapping(database, {
        rawName: card.name,
        sourceContext: {
          rawDeckId: rawDeck.id,
          source: rawDeck.source,
          sourceUrl: rawDeck.sourceUrl,
          zone
        },
        status: "unresolved"
      });
      continue;
    }

    cards.push({
      copies: card.copies,
      name: canonicalName
    });
    auditByRawName.set(card.name, {
      canonicalName,
      rawName: card.name,
      status: "mapped"
    });
    upsertCardNameMapping(database, {
      canonicalName,
      rawName: card.name,
      sourceContext: {
        rawDeckId: rawDeck.id,
        source: rawDeck.source,
        sourceUrl: rawDeck.sourceUrl,
        zone
      },
      status: "mapped"
    });
  }

  return { cards, unresolved };
}

function buildNormalizedDeck(
  rawDeck: RawDeckRecord,
  mainboard: readonly DeckCard[],
  sideboard: readonly DeckCard[]
): NormalizedDeck {
  const eventDate = rawDeck.eventDate ?? "1970-01-01";
  const archetype = rawDeck.reportedArchetype ?? "Unknown";

  return {
    archetype,
    archetypeFamily: archetype,
    deckId: stableId("normalized-deck", rawDeck.id),
    eventDate,
    fingerprint: deckFingerprint(mainboard),
    mainboard,
    rawDeckId: rawDeck.id,
    sideboard,
    source: rawDeck.source,
    sourceUrl: rawDeck.sourceUrl,
    weight: 1,
    year: Number(eventDate.slice(0, 4))
  };
}

function deckFingerprint(mainboard: readonly DeckCard[]): string {
  return createHash("sha256")
    .update(
      [...mainboard]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((card) => `${card.copies} ${card.name}`)
        .join("\n")
    )
    .digest("hex");
}

function writeAuditCsv(filePath: string, rows: readonly CardNormalizationAuditRow[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "raw_name,canonical_name,status",
      ...rows.map((row) => [row.rawName, row.canonicalName ?? "", row.status].map(csvEscape).join(","))
    ].join("\n") + "\n"
  );
}

function csvEscape(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, "\"\"")}"`;
}

function scryfallCardToInput(card: ScryfallCard): CardInput {
  return {
    canonicalName: card.name ?? "",
    colorIdentity: card.color_identity ?? [],
    colors: card.colors ?? [],
    manaValue: card.cmc,
    metadata: {
      digital: card.digital ?? false,
      layout: card.layout
    },
    scryfallId: card.id,
    typeLine: card.type_line
  };
}

function isUnwantedScryfallCard(card: ScryfallCard): boolean {
  return card.layout === "art_series" || card.layout === "token" || card.layout === "double_faced_token";
}

function stableId(scope: string, ...parts: readonly string[]): string {
  return createHash("sha256").update([scope, ...parts].join("\0")).digest("hex");
}
