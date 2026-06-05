import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { DeckCard, DeckSource, NormalizedDeck, RawDeck } from "../types/contracts.js";

export type SourceSnapshotInput = {
  readonly source: DeckSource;
  readonly sourceUrl: string;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly httpStatus?: number;
  readonly error?: string;
  readonly rawPath?: string;
  readonly parserVersion?: string;
  readonly metadata?: unknown;
};

export type CardInput = {
  readonly canonicalName: string;
  readonly scryfallId?: string;
  readonly colors?: readonly string[];
  readonly colorIdentity?: readonly string[];
  readonly typeLine?: string;
  readonly manaValue?: number;
  readonly metadata?: unknown;
};

export type CardNameMappingInput = {
  readonly rawName: string;
  readonly canonicalName?: string;
  readonly status: "mapped" | "unresolved" | "ignored";
  readonly sourceContext?: unknown;
};

export type ArchetypeMappingInput = {
  readonly reportedLabel: string;
  readonly archetype: string;
  readonly archetypeFamily: string;
  readonly confidence?: number;
  readonly manualOverride?: boolean;
  readonly auditStatus?: "mapped" | "ambiguous" | "unmapped";
};

export type MatrixInputRow = {
  readonly deckId: string;
  readonly archetypeFamily: string;
  readonly weight: number;
  readonly zone: "mainboard" | "sideboard";
  readonly cardName: string;
  readonly copies: number;
};

export function upsertSourceSnapshot(database: DatabaseSync, input: SourceSnapshotInput): string {
  const id = stableId("source-snapshot", input.source, input.sourceUrl, input.contentHash);

  database
    .prepare(
      `INSERT INTO source_snapshots (
        id, source, source_url, fetched_at, content_hash, http_status, error,
        raw_path, parser_version, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, source_url, content_hash) DO UPDATE SET
        fetched_at = excluded.fetched_at,
        http_status = excluded.http_status,
        error = excluded.error,
        raw_path = excluded.raw_path,
        parser_version = excluded.parser_version,
        metadata_json = excluded.metadata_json`
    )
    .run(
      id,
      input.source,
      input.sourceUrl,
      input.fetchedAt,
      input.contentHash,
      input.httpStatus ?? null,
      input.error ?? null,
      input.rawPath ?? null,
      input.parserVersion ?? null,
      JSON.stringify(input.metadata ?? {})
    );

  return id;
}

export function upsertRawDeck(
  database: DatabaseSync,
  input: RawDeck,
  options: { readonly snapshotId?: string; readonly rawDeckId?: string } = {}
): string {
  const rawDeckId = options.rawDeckId ?? stableId("raw-deck", input.source, input.sourceUrl);

  database.exec("BEGIN;");
  try {
    database
      .prepare(
        `INSERT INTO raw_decks (
          id, snapshot_id, source, source_url, event_name, event_date, format,
          player, placement, reported_archetype, raw_json, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          snapshot_id = excluded.snapshot_id,
          source = excluded.source,
          source_url = excluded.source_url,
          event_name = excluded.event_name,
          event_date = excluded.event_date,
          format = excluded.format,
          player = excluded.player,
          placement = excluded.placement,
          reported_archetype = excluded.reported_archetype,
          raw_json = excluded.raw_json,
          updated_at = excluded.updated_at`
      )
      .run(
        rawDeckId,
        options.snapshotId ?? null,
        input.source,
        input.sourceUrl,
        input.eventName ?? null,
        input.eventDate ?? null,
        input.format,
        input.player ?? null,
        input.placement ?? null,
        input.reportedArchetype ?? null,
        JSON.stringify(input),
        new Date().toISOString()
      );

    replaceRawDeckCards(database, rawDeckId, "mainboard", input.mainboard);
    replaceRawDeckCards(database, rawDeckId, "sideboard", input.sideboard);

    database.exec("COMMIT;");
    return rawDeckId;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function upsertCard(database: DatabaseSync, input: CardInput): void {
  database
    .prepare(
      `INSERT INTO cards (
        canonical_name, scryfall_id, colors_json, color_identity_json,
        type_line, mana_value, metadata_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(canonical_name) DO UPDATE SET
        scryfall_id = excluded.scryfall_id,
        colors_json = excluded.colors_json,
        color_identity_json = excluded.color_identity_json,
        type_line = excluded.type_line,
        mana_value = excluded.mana_value,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`
    )
    .run(
      input.canonicalName,
      input.scryfallId ?? null,
      JSON.stringify(input.colors ?? []),
      JSON.stringify(input.colorIdentity ?? []),
      input.typeLine ?? null,
      input.manaValue ?? null,
      JSON.stringify(input.metadata ?? {}),
      new Date().toISOString()
    );
}

export function upsertCardNameMapping(database: DatabaseSync, input: CardNameMappingInput): void {
  database
    .prepare(
      `INSERT INTO card_name_mappings (
        raw_name, canonical_name, status, source_context_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(raw_name) DO UPDATE SET
        canonical_name = excluded.canonical_name,
        status = excluded.status,
        source_context_json = excluded.source_context_json,
        updated_at = excluded.updated_at`
    )
    .run(
      input.rawName,
      input.canonicalName ?? null,
      input.status,
      JSON.stringify(input.sourceContext ?? {}),
      new Date().toISOString()
    );
}

export function upsertArchetypeMapping(database: DatabaseSync, input: ArchetypeMappingInput): void {
  database
    .prepare(
      `INSERT INTO archetype_mappings (
        reported_label, archetype, archetype_family, confidence,
        manual_override, audit_status, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(reported_label) DO UPDATE SET
        archetype = excluded.archetype,
        archetype_family = excluded.archetype_family,
        confidence = excluded.confidence,
        manual_override = excluded.manual_override,
        audit_status = excluded.audit_status,
        updated_at = excluded.updated_at`
    )
    .run(
      input.reportedLabel,
      input.archetype,
      input.archetypeFamily,
      input.confidence ?? 1,
      input.manualOverride === true ? 1 : 0,
      input.auditStatus ?? "mapped",
      new Date().toISOString()
    );
}

export function upsertNormalizedDeck(database: DatabaseSync, input: NormalizedDeck): void {
  database.exec("BEGIN;");
  try {
    database
      .prepare(
        `INSERT INTO normalized_decks (
          deck_id, source, source_url, event_date, year, archetype,
          archetype_family, fingerprint, weight, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(deck_id) DO UPDATE SET
          source = excluded.source,
          source_url = excluded.source_url,
          event_date = excluded.event_date,
          year = excluded.year,
          archetype = excluded.archetype,
          archetype_family = excluded.archetype_family,
          fingerprint = excluded.fingerprint,
          weight = excluded.weight,
          updated_at = excluded.updated_at`
      )
      .run(
        input.deckId,
        input.source,
        input.sourceUrl,
        input.eventDate,
        input.year,
        input.archetype,
        input.archetypeFamily,
        input.fingerprint,
        input.weight,
        new Date().toISOString()
      );

    replaceNormalizedDeckCards(database, input.deckId, "mainboard", input.mainboard);
    replaceNormalizedDeckCards(database, input.deckId, "sideboard", input.sideboard);

    database
      .prepare(
        `INSERT INTO deck_weights (deck_id, weight, explanation, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(deck_id) DO UPDATE SET
           weight = excluded.weight,
           explanation = excluded.explanation,
           updated_at = excluded.updated_at`
      )
      .run(input.deckId, input.weight, "Initial normalized deck weight", new Date().toISOString());

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listMatrixInputRows(database: DatabaseSync): readonly MatrixInputRow[] {
  const rows = database
    .prepare(
      `SELECT
        nd.deck_id AS deckId,
        nd.archetype_family AS archetypeFamily,
        COALESCE(dw.weight, nd.weight) AS weight,
        ndc.zone AS zone,
        ndc.card_name AS cardName,
        ndc.copies AS copies
      FROM normalized_decks nd
      JOIN normalized_deck_cards ndc ON ndc.deck_id = nd.deck_id
      LEFT JOIN deck_weights dw ON dw.deck_id = nd.deck_id
      ORDER BY nd.archetype_family, nd.deck_id, ndc.zone, ndc.position`
    )
    .all();

  return rows.map((row) => ({
    archetypeFamily: String(row.archetypeFamily),
    cardName: String(row.cardName),
    copies: Number(row.copies),
    deckId: String(row.deckId),
    weight: Number(row.weight),
    zone: String(row.zone) === "sideboard" ? "sideboard" : "mainboard"
  }));
}

function replaceRawDeckCards(
  database: DatabaseSync,
  rawDeckId: string,
  zone: "mainboard" | "sideboard",
  cards: readonly DeckCard[]
): void {
  database.prepare("DELETE FROM raw_deck_cards WHERE raw_deck_id = ? AND zone = ?").run(rawDeckId, zone);

  const insert = database.prepare(
    `INSERT INTO raw_deck_cards (raw_deck_id, zone, name, copies, position)
     VALUES (?, ?, ?, ?, ?)`
  );

  cards.forEach((card, index) => {
    insert.run(rawDeckId, zone, card.name, card.copies, index);
  });
}

function replaceNormalizedDeckCards(
  database: DatabaseSync,
  deckId: string,
  zone: "mainboard" | "sideboard",
  cards: readonly DeckCard[]
): void {
  database.prepare("DELETE FROM normalized_deck_cards WHERE deck_id = ? AND zone = ?").run(deckId, zone);

  const insert = database.prepare(
    `INSERT INTO normalized_deck_cards (deck_id, zone, card_name, copies, position)
     VALUES (?, ?, ?, ?, ?)`
  );

  cards.forEach((card, index) => {
    insert.run(deckId, zone, card.name, card.copies, index);
  });
}

function stableId(scope: string, ...parts: readonly string[]): string {
  return createHash("sha256").update([scope, ...parts].join("\0")).digest("hex");
}

export function createPipelineRunId(): string {
  return randomUUID();
}
