import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { CandidatePool, CardScoreRow, CubeCardRole, DeckCard, DeckSource, NormalizedDeck, RawDeck } from "../types/contracts.js";

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

export type RawDeckRecord = {
  readonly id: string;
  readonly source: DeckSource;
  readonly sourceUrl: string;
  readonly eventDate?: string;
  readonly reportedArchetype?: string;
};

export type RawDeckCardRecord = {
  readonly rawDeckId: string;
  readonly zone: "mainboard" | "sideboard";
  readonly name: string;
  readonly copies: number;
  readonly position: number;
};

export type CardNameMappingRecord = {
  readonly rawName: string;
  readonly canonicalName?: string;
  readonly status: "mapped" | "unresolved" | "ignored";
};

export type NormalizedDeckArchetypeRecord = {
  readonly deckId: string;
  readonly archetype: string;
  readonly archetypeFamily: string;
};

export type NormalizedDeckDedupeRecord = {
  readonly deckId: string;
  readonly eventDate: string;
  readonly archetypeFamily: string;
  readonly fingerprint: string;
  readonly mainboard: readonly DeckCard[];
};

export type DedupeClusterInput = {
  readonly clusterId: string;
  readonly strategy: "exact" | "near";
  readonly archetypeFamily?: string;
  readonly eventMonth?: string;
  readonly explanation: string;
};

export type DeckWeightInput = {
  readonly deckId: string;
  readonly exactDuplicateClusterId?: string;
  readonly nearDuplicateClusterId?: string;
  readonly weight: number;
  readonly explanation: string;
};

export type PipelineRunInput = {
  readonly id: string;
  readonly configHash: string;
  readonly status?: "running" | "completed" | "failed";
  readonly startedAt?: string;
  readonly completedAt?: string;
};

export type CardArchetypeMatrixInput = {
  readonly pipelineRunId: string;
  readonly cardName: string;
  readonly archetypeFamily: string;
  readonly decksWithCard: number;
  readonly totalDecksInArchetype: number;
  readonly mainboardCopies: number;
  readonly sideboardCopies: number;
  readonly affinity: number;
};

export type CardScoreInput = CardScoreRow & {
  readonly pipelineRunId: string;
};

export type PersistedCardRecord = {
  readonly canonicalName: string;
  readonly typeLine?: string;
  readonly manaValue?: number;
  readonly colors: readonly string[];
  readonly colorIdentity: readonly string[];
};

export type CandidatePoolCardInput = {
  readonly pipelineRunId: string;
  readonly cardName: string;
  readonly pool: CandidatePool;
  readonly score: number;
  readonly roles: readonly CubeCardRole[];
  readonly explanation: string;
};

export type CubeRunInput = {
  readonly id: string;
  readonly pipelineRunId?: string;
  readonly config: unknown;
  readonly createdAt?: string;
  readonly totalCards: number;
};

export type CubeRunCardInput = {
  readonly cubeRunId: string;
  readonly cardName: string;
  readonly position: number;
  readonly roles: readonly CubeCardRole[];
  readonly reason: string;
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

export function upsertPipelineRun(database: DatabaseSync, input: PipelineRunInput): void {
  database
    .prepare(
      `INSERT INTO pipeline_runs (id, started_at, completed_at, config_hash, status)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         completed_at = excluded.completed_at,
         config_hash = excluded.config_hash,
         status = excluded.status`
    )
    .run(
      input.id,
      input.startedAt ?? new Date().toISOString(),
      input.completedAt ?? null,
      input.configHash,
      input.status ?? "running"
    );
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
          deck_id, raw_deck_id, source, source_url, event_date, year, archetype,
          archetype_family, fingerprint, weight, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(deck_id) DO UPDATE SET
          raw_deck_id = excluded.raw_deck_id,
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
        input.rawDeckId ?? null,
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

export function listRawDeckRecords(database: DatabaseSync): readonly RawDeckRecord[] {
  const rows = database
    .prepare(
      `SELECT id, source, source_url AS sourceUrl, event_date AS eventDate, reported_archetype AS reportedArchetype
       FROM raw_decks
       ORDER BY source, event_date, id`
    )
    .all();

  return rows.map((row) => ({
    eventDate: row.eventDate === null || row.eventDate === undefined ? undefined : String(row.eventDate),
    id: String(row.id),
    reportedArchetype:
      row.reportedArchetype === null || row.reportedArchetype === undefined ? undefined : String(row.reportedArchetype),
    source: String(row.source) as DeckSource,
    sourceUrl: String(row.sourceUrl)
  }));
}

export function listRawDeckCardRecords(database: DatabaseSync, rawDeckId: string): readonly RawDeckCardRecord[] {
  const rows = database
    .prepare(
      `SELECT raw_deck_id AS rawDeckId, zone, name, copies, position
       FROM raw_deck_cards
       WHERE raw_deck_id = ?
       ORDER BY zone, position`
    )
    .all(rawDeckId);

  return rows.map((row) => ({
    copies: Number(row.copies),
    name: String(row.name),
    position: Number(row.position),
    rawDeckId: String(row.rawDeckId),
    zone: String(row.zone) === "sideboard" ? "sideboard" : "mainboard"
  }));
}

export function listCardNameMappings(database: DatabaseSync): readonly CardNameMappingRecord[] {
  const rows = database
    .prepare("SELECT raw_name AS rawName, canonical_name AS canonicalName, status FROM card_name_mappings")
    .all();

  return rows.map((row) => ({
    canonicalName: row.canonicalName === null || row.canonicalName === undefined ? undefined : String(row.canonicalName),
    rawName: String(row.rawName),
    status: normalizeMappingStatus(String(row.status))
  }));
}

export function listCanonicalCardNames(database: DatabaseSync): readonly string[] {
  const rows = database.prepare("SELECT canonical_name AS canonicalName FROM cards ORDER BY canonical_name").all();
  return rows.map((row) => String(row.canonicalName));
}

export function listNormalizedDeckArchetypes(database: DatabaseSync): readonly NormalizedDeckArchetypeRecord[] {
  const rows = database
    .prepare(
      `SELECT deck_id AS deckId, archetype, archetype_family AS archetypeFamily
       FROM normalized_decks
       ORDER BY deck_id`
    )
    .all();

  return rows.map((row) => ({
    archetype: String(row.archetype),
    archetypeFamily: String(row.archetypeFamily),
    deckId: String(row.deckId)
  }));
}

export function updateNormalizedDeckArchetype(
  database: DatabaseSync,
  input: NormalizedDeckArchetypeRecord
): void {
  database
    .prepare(
      `UPDATE normalized_decks
       SET archetype = ?, archetype_family = ?, updated_at = ?
       WHERE deck_id = ?`
    )
    .run(input.archetype, input.archetypeFamily, new Date().toISOString(), input.deckId);
}

export function listNormalizedDecksForDedupe(database: DatabaseSync): readonly NormalizedDeckDedupeRecord[] {
  const decks = database
    .prepare(
      `SELECT deck_id AS deckId, event_date AS eventDate, archetype_family AS archetypeFamily, fingerprint
       FROM normalized_decks
       ORDER BY event_date, archetype_family, deck_id`
    )
    .all();
  const cardRows = database
    .prepare(
      `SELECT deck_id AS deckId, card_name AS cardName, copies
       FROM normalized_deck_cards
       WHERE zone = 'mainboard'
       ORDER BY deck_id, position`
    )
    .all();
  const cardsByDeckId = new Map<string, DeckCard[]>();

  for (const row of cardRows) {
    const deckId = String(row.deckId);
    cardsByDeckId.set(deckId, [
      ...(cardsByDeckId.get(deckId) ?? []),
      { copies: Number(row.copies), name: String(row.cardName) }
    ]);
  }

  return decks.map((row) => ({
    archetypeFamily: String(row.archetypeFamily),
    deckId: String(row.deckId),
    eventDate: String(row.eventDate),
    fingerprint: String(row.fingerprint),
    mainboard: cardsByDeckId.get(String(row.deckId)) ?? []
  }));
}

export function updateNormalizedDeckFingerprint(database: DatabaseSync, deckId: string, fingerprint: string): void {
  database
    .prepare("UPDATE normalized_decks SET fingerprint = ?, updated_at = ? WHERE deck_id = ?")
    .run(fingerprint, new Date().toISOString(), deckId);
}

export function upsertDedupeCluster(database: DatabaseSync, input: DedupeClusterInput): void {
  database
    .prepare(
      `INSERT INTO dedupe_clusters (
        cluster_id, strategy, archetype_family, event_month, explanation
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(cluster_id) DO UPDATE SET
        strategy = excluded.strategy,
        archetype_family = excluded.archetype_family,
        event_month = excluded.event_month,
        explanation = excluded.explanation`
    )
    .run(
      input.clusterId,
      input.strategy,
      input.archetypeFamily ?? null,
      input.eventMonth ?? null,
      input.explanation
    );
}

export function upsertDeckWeight(database: DatabaseSync, input: DeckWeightInput): void {
  database
    .prepare(
      `INSERT INTO deck_weights (
        deck_id, exact_duplicate_cluster_id, near_duplicate_cluster_id,
        weight, explanation, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(deck_id) DO UPDATE SET
        exact_duplicate_cluster_id = excluded.exact_duplicate_cluster_id,
        near_duplicate_cluster_id = excluded.near_duplicate_cluster_id,
        weight = excluded.weight,
        explanation = excluded.explanation,
        updated_at = excluded.updated_at`
    )
    .run(
      input.deckId,
      input.exactDuplicateClusterId ?? null,
      input.nearDuplicateClusterId ?? null,
      input.weight,
      input.explanation,
      new Date().toISOString()
    );
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

export function replaceCardArchetypeMatrixRows(
  database: DatabaseSync,
  pipelineRunId: string,
  rows: readonly CardArchetypeMatrixInput[]
): void {
  database.exec("BEGIN;");
  try {
    database.prepare("DELETE FROM card_archetype_matrix WHERE pipeline_run_id = ?").run(pipelineRunId);
    const insert = database.prepare(
      `INSERT INTO card_archetype_matrix (
        pipeline_run_id, card_name, archetype_family, decks_with_card,
        total_decks_in_archetype, mainboard_copies, sideboard_copies, affinity
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const row of rows) {
      insert.run(
        row.pipelineRunId,
        row.cardName,
        row.archetypeFamily,
        row.decksWithCard,
        row.totalDecksInArchetype,
        row.mainboardCopies,
        row.sideboardCopies,
        row.affinity
      );
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listPersistedMatrixRows(
  database: DatabaseSync,
  pipelineRunId: string
): readonly CardArchetypeMatrixInput[] {
  const rows = database
    .prepare(
      `SELECT
        pipeline_run_id AS pipelineRunId,
        card_name AS cardName,
        archetype_family AS archetypeFamily,
        decks_with_card AS decksWithCard,
        total_decks_in_archetype AS totalDecksInArchetype,
        mainboard_copies AS mainboardCopies,
        sideboard_copies AS sideboardCopies,
        affinity
      FROM card_archetype_matrix
      WHERE pipeline_run_id = ?
      ORDER BY archetype_family, card_name`
    )
    .all(pipelineRunId);

  return rows.map((row) => ({
    affinity: Number(row.affinity),
    archetypeFamily: String(row.archetypeFamily),
    cardName: String(row.cardName),
    decksWithCard: Number(row.decksWithCard),
    mainboardCopies: Number(row.mainboardCopies),
    pipelineRunId: String(row.pipelineRunId),
    sideboardCopies: Number(row.sideboardCopies),
    totalDecksInArchetype: Number(row.totalDecksInArchetype)
  }));
}

export function replaceCardScoreRows(
  database: DatabaseSync,
  pipelineRunId: string,
  rows: readonly CardScoreInput[]
): void {
  database.exec("BEGIN;");
  try {
    database.prepare("DELETE FROM card_scores WHERE pipeline_run_id = ?").run(pipelineRunId);
    const insert = database.prepare(
      `INSERT INTO card_scores (
        pipeline_run_id, card_name, frequency, glue_score, weighted_glue_score,
        highest_affinity, second_highest_affinity, exclusivity_score,
        signpost_score, parasitic_score, cube_score
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const row of rows) {
      insert.run(
        row.pipelineRunId,
        row.cardName,
        row.frequency,
        row.glueScore,
        row.weightedGlueScore,
        row.highestAffinity,
        row.secondHighestAffinity,
        row.exclusivityScore,
        row.signpostScore,
        row.parasiticScore,
        row.cubeScore
      );
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listPersistedCardScores(database: DatabaseSync, pipelineRunId: string): readonly CardScoreInput[] {
  const rows = database
    .prepare(
      `SELECT
        pipeline_run_id AS pipelineRunId,
        card_name AS cardName,
        frequency,
        glue_score AS glueScore,
        weighted_glue_score AS weightedGlueScore,
        highest_affinity AS highestAffinity,
        second_highest_affinity AS secondHighestAffinity,
        exclusivity_score AS exclusivityScore,
        signpost_score AS signpostScore,
        parasitic_score AS parasiticScore,
        cube_score AS cubeScore
      FROM card_scores
      WHERE pipeline_run_id = ?
      ORDER BY cube_score DESC, card_name`
    )
    .all(pipelineRunId);

  return rows.map((row) => ({
    cardName: String(row.cardName),
    cubeScore: Number(row.cubeScore),
    exclusivityScore: Number(row.exclusivityScore),
    frequency: Number(row.frequency),
    glueScore: Number(row.glueScore),
    highestAffinity: Number(row.highestAffinity),
    parasiticScore: Number(row.parasiticScore),
    pipelineRunId: String(row.pipelineRunId),
    secondHighestAffinity: Number(row.secondHighestAffinity),
    signpostScore: Number(row.signpostScore),
    weightedGlueScore: Number(row.weightedGlueScore)
  }));
}

export function listPersistedCards(database: DatabaseSync): readonly PersistedCardRecord[] {
  const rows = database
    .prepare(
      `SELECT canonical_name AS canonicalName, type_line AS typeLine, mana_value AS manaValue,
              colors_json AS colorsJson, color_identity_json AS colorIdentityJson
       FROM cards
       ORDER BY canonical_name`
    )
    .all();

  return rows.map((row) => ({
    canonicalName: String(row.canonicalName),
    colorIdentity: parseJsonArray(row.colorIdentityJson),
    colors: parseJsonArray(row.colorsJson),
    manaValue: row.manaValue === null || row.manaValue === undefined ? undefined : Number(row.manaValue),
    typeLine: row.typeLine === null || row.typeLine === undefined ? undefined : String(row.typeLine)
  }));
}

export function replaceCandidatePoolCards(
  database: DatabaseSync,
  pipelineRunId: string,
  rows: readonly CandidatePoolCardInput[]
): void {
  database.exec("BEGIN;");
  try {
    database.prepare("DELETE FROM candidate_pool_cards WHERE pipeline_run_id = ?").run(pipelineRunId);
    const insert = database.prepare(
      `INSERT INTO candidate_pool_cards (
        pipeline_run_id, card_name, pool, score, roles_json, explanation
      )
      VALUES (?, ?, ?, ?, ?, ?)`
    );

    for (const row of rows) {
      insert.run(
        row.pipelineRunId,
        row.cardName,
        row.pool,
        row.score,
        JSON.stringify(row.roles),
        row.explanation
      );
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listPersistedCandidatePoolCards(
  database: DatabaseSync,
  pipelineRunId: string
): readonly CandidatePoolCardInput[] {
  const rows = database
    .prepare(
      `SELECT pipeline_run_id AS pipelineRunId, card_name AS cardName, pool, score, roles_json AS rolesJson, explanation
       FROM candidate_pool_cards
       WHERE pipeline_run_id = ?
       ORDER BY pool, score DESC, card_name`
    )
    .all(pipelineRunId);

  return rows.map((row) => ({
    cardName: String(row.cardName),
    explanation: String(row.explanation),
    pipelineRunId: String(row.pipelineRunId),
    pool: String(row.pool) as CandidatePool,
    roles: parseJsonArray(row.rolesJson).filter(isCubeCardRole),
    score: Number(row.score)
  }));
}

export function upsertCubeRun(database: DatabaseSync, input: CubeRunInput): void {
  database
    .prepare(
      `INSERT INTO cube_runs (id, pipeline_run_id, config_json, created_at, total_cards)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         pipeline_run_id = excluded.pipeline_run_id,
         config_json = excluded.config_json,
         created_at = excluded.created_at,
         total_cards = excluded.total_cards`
    )
    .run(
      input.id,
      input.pipelineRunId ?? null,
      JSON.stringify(input.config),
      input.createdAt ?? new Date().toISOString(),
      input.totalCards
    );
}

export function replaceCubeRunCards(
  database: DatabaseSync,
  cubeRunId: string,
  cards: readonly CubeRunCardInput[]
): void {
  database.exec("BEGIN;");
  try {
    database.prepare("DELETE FROM cube_run_cards WHERE cube_run_id = ?").run(cubeRunId);
    const insert = database.prepare(
      `INSERT INTO cube_run_cards (cube_run_id, card_name, position, roles_json, reason)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const card of cards) {
      insert.run(card.cubeRunId, card.cardName, card.position, JSON.stringify(card.roles), card.reason);
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listCubeRunCards(database: DatabaseSync, cubeRunId: string): readonly CubeRunCardInput[] {
  const rows = database
    .prepare(
      `SELECT cube_run_id AS cubeRunId, card_name AS cardName, position, roles_json AS rolesJson, reason
       FROM cube_run_cards
       WHERE cube_run_id = ?
       ORDER BY position`
    )
    .all(cubeRunId);

  return rows.map((row) => ({
    cardName: String(row.cardName),
    cubeRunId: String(row.cubeRunId),
    position: Number(row.position),
    reason: String(row.reason),
    roles: parseJsonArray(row.rolesJson).filter(isCubeCardRole)
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

function normalizeMappingStatus(value: string): CardNameMappingRecord["status"] {
  if (value === "mapped" || value === "ignored") {
    return value;
  }

  return "unresolved";
}

function parseJsonArray(value: unknown): readonly string[] {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}

function isCubeCardRole(value: string): value is CubeCardRole {
  return value === "glue" || value === "signpost" || value === "fixing" || value === "support" || value === "curve" || value === "role";
}
