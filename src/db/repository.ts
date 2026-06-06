import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type {
  CandidatePool,
  ArchetypePeriodSummaryRow,
  ArchetypeReconstructionTargetRow,
  CardScoreRow,
  CardPeriodMatrixRow,
  CubeArchetypeReconstructionRow,
  CubeCardRole,
  DeckCard,
  DeckSource,
  HistoricalCoverageWarning,
  HistoricalCoverageWarningType,
  HistoricalCardRole,
  HistoricalCardScoreRow,
  HistoricalValidationMetricRow,
  HistoricalValidationStatus,
  HistoricalValidationWarningRow,
  HistoricalSourceCoverageRow,
  HistoricalSourceCoverageStatus,
  EcosystemDiversitySummaryRow,
  MetaPeriod,
  MetagamePeriodAssignmentReview,
  MetagamePeriodModel,
  NormalizedDeck,
  RawDeck,
  SetRelease,
  StandardSetType
} from "../types/contracts.js";

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

export type NormalizedDeckPeriodCandidateRecord = {
  readonly deckId: string;
  readonly eventDate?: string;
};

export type DeckMetagamePeriodAssignmentInput = {
  readonly deckId: string;
  readonly periodId: string;
};

export type DeckMetagamePeriodAssignmentRecord = {
  readonly deckId: string;
  readonly periodId: string;
  readonly assignedAt: string;
};

export type MetagamePeriodAssignmentReviewRecord = {
  readonly id: number;
  readonly deckId?: string;
  readonly eventDate?: string;
  readonly reason: string;
  readonly metadata: unknown;
  readonly createdAt: string;
};

export type HistoricalCoverageInputRecord = {
  readonly deckId: string;
  readonly periodId: string;
  readonly source: DeckSource;
  readonly archetypeFamily: string;
};

export type HistoricalCoverageWarningRecord = HistoricalCoverageWarning & {
  readonly id: number;
  readonly createdAt: string;
};

export type PeriodMatrixInputRow = {
  readonly deckId: string;
  readonly periodId: string;
  readonly setCode: string;
  readonly setName: string;
  readonly periodStartDate: string;
  readonly periodEndDate: string;
  readonly sortOrder: number;
  readonly archetypeFamily: string;
  readonly weight: number;
  readonly zone: "mainboard" | "sideboard";
  readonly cardName: string;
  readonly copies: number;
};

export type HistoricalScoreInputRow = {
  readonly cardName: string;
  readonly periodId: string;
  readonly metagameShare: number;
  readonly mainboardCopies: number;
  readonly sideboardCopies: number;
  readonly archetypeFamilies: readonly string[];
};

export type HistoricalValidationRunInput = {
  readonly id: string;
  readonly cubeRunId: string;
  readonly pipelineRunId: string;
  readonly status: HistoricalValidationStatus;
  readonly config: unknown;
};

export type PersistedHistoricalValidationWarningRecord = HistoricalValidationWarningRow & {
  readonly id: number;
  readonly createdAt: string;
};

export type CollectionDateReviewInput = {
  readonly source: DeckSource;
  readonly sourceUrl: string;
  readonly eventDate?: string;
  readonly reason: "missing_event_date" | "invalid_event_date" | "out_of_range";
  readonly metadata?: unknown;
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

export type PipelineStageRunInput = {
  readonly pipelineRunId: string;
  readonly stage: string;
  readonly status: "running" | "completed" | "failed";
  readonly configHash: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly inputRefs?: unknown;
  readonly outputRefs?: unknown;
  readonly rowCount?: number;
  readonly error?: unknown;
};

export type ConfigProfileInput = {
  readonly name: string;
  readonly configHash: string;
  readonly config: unknown;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type OutputArtifactInput = {
  readonly id?: string;
  readonly pipelineRunId?: string;
  readonly stage: string;
  readonly path: string;
  readonly format: string;
  readonly contentHash: string;
  readonly generatedAt?: string;
  readonly sourceMetadata?: unknown;
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

export type ValidationRunInput = {
  readonly id: string;
  readonly cubeRunId: string;
  readonly config: unknown;
  readonly createdAt?: string;
  readonly totalCards: number;
  readonly status: "pass" | "warn" | "fail";
};

export type ValidationWarningInput = {
  readonly validationRunId: string;
  readonly level: "pass" | "warn" | "fail";
  readonly code: string;
  readonly message: string;
  readonly metadata?: unknown;
};

export type ValidationMetricInput = {
  readonly validationRunId: string;
  readonly metricKey: string;
  readonly label: string;
  readonly value: number;
  readonly metadata?: unknown;
};

export type ValidationZeroSupportCardInput = {
  readonly validationRunId: string;
  readonly cardName: string;
  readonly section: string;
  readonly position: number;
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

export function upsertPipelineStageRun(database: DatabaseSync, input: PipelineStageRunInput): void {
  database
    .prepare(
      `INSERT INTO pipeline_stage_runs (
        pipeline_run_id, stage, status, config_hash, started_at, completed_at,
        input_refs_json, output_refs_json, row_count, error_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pipeline_run_id, stage) DO UPDATE SET
        status = excluded.status,
        config_hash = excluded.config_hash,
        completed_at = excluded.completed_at,
        input_refs_json = excluded.input_refs_json,
        output_refs_json = excluded.output_refs_json,
        row_count = excluded.row_count,
        error_json = excluded.error_json`
    )
    .run(
      input.pipelineRunId,
      input.stage,
      input.status,
      input.configHash,
      input.startedAt ?? new Date().toISOString(),
      input.completedAt ?? null,
      JSON.stringify(input.inputRefs ?? {}),
      JSON.stringify(input.outputRefs ?? {}),
      input.rowCount ?? 0,
      JSON.stringify(input.error ?? {})
    );
}

export function upsertConfigProfile(database: DatabaseSync, input: ConfigProfileInput): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO config_profiles (name, config_hash, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         config_hash = excluded.config_hash,
         config_json = excluded.config_json,
         updated_at = excluded.updated_at`
    )
    .run(input.name, input.configHash, JSON.stringify(input.config), input.createdAt ?? now, input.updatedAt ?? now);
}

export function registerOutputArtifact(database: DatabaseSync, input: OutputArtifactInput): string {
  const id = input.id ?? stableId("output-artifact", input.path, input.contentHash);
  database
    .prepare(
      `INSERT INTO output_artifacts (
        id, pipeline_run_id, stage, path, format, content_hash, generated_at, source_metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path, content_hash) DO UPDATE SET
        pipeline_run_id = excluded.pipeline_run_id,
        stage = excluded.stage,
        format = excluded.format,
        generated_at = excluded.generated_at,
        source_metadata_json = excluded.source_metadata_json`
    )
    .run(
      id,
      input.pipelineRunId ?? null,
      input.stage,
      input.path,
      input.format,
      input.contentHash,
      input.generatedAt ?? new Date().toISOString(),
      JSON.stringify(input.sourceMetadata ?? {})
    );

  return id;
}

export function upsertRawDeck(
  database: DatabaseSync,
  input: RawDeck,
  options: {
    readonly active?: boolean;
    readonly collectionStatus?: "active" | "missing_event_date" | "invalid_event_date" | "out_of_range";
    readonly snapshotId?: string;
    readonly rawDeckId?: string;
  } = {}
): string {
  const rawDeckId = options.rawDeckId ?? stableId("raw-deck", input.source, input.sourceUrl);
  const collectionStatus = options.collectionStatus ?? "active";

  database.exec("BEGIN;");
  try {
    database
      .prepare(
        `INSERT INTO raw_decks (
          id, snapshot_id, source, source_url, event_name, event_date, format,
          player, placement, reported_archetype, raw_json, active, collection_status, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          active = excluded.active,
          collection_status = excluded.collection_status,
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
        options.active === false ? 0 : 1,
        collectionStatus,
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

export function insertCollectionDateReview(database: DatabaseSync, input: CollectionDateReviewInput): void {
  database
    .prepare(
      `INSERT INTO collection_date_reviews (
        source, source_url, event_date, reason, metadata_json
      )
      VALUES (?, ?, ?, ?, ?)`
    )
    .run(input.source, input.sourceUrl, input.eventDate ?? null, input.reason, JSON.stringify(input.metadata ?? {}));
}

export function listCollectionDateReviews(database: DatabaseSync): readonly (CollectionDateReviewInput & { readonly id: number })[] {
  const rows = database
    .prepare(
      `SELECT id, source, source_url AS sourceUrl, event_date AS eventDate, reason, metadata_json AS metadataJson
       FROM collection_date_reviews
       ORDER BY id`
    )
    .all();

  return rows.map((row) => ({
    eventDate: row.eventDate === null || row.eventDate === undefined ? undefined : String(row.eventDate),
    id: Number(row.id),
    metadata: parseJson(String(row.metadataJson), {}),
    reason: String(row.reason) as CollectionDateReviewInput["reason"],
    source: String(row.source) as DeckSource,
    sourceUrl: String(row.sourceUrl)
  }));
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

export function replaceSetReleases(database: DatabaseSync, releases: readonly SetRelease[]): void {
  database.exec("BEGIN;");
  try {
    const insert = database.prepare(
      `INSERT INTO set_releases (
        set_code, set_name, release_date, set_type, source, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(set_code) DO UPDATE SET
        set_name = excluded.set_name,
        release_date = excluded.release_date,
        set_type = excluded.set_type,
        source = excluded.source,
        metadata_json = excluded.metadata_json`
    );

    for (const release of releases) {
      insert.run(
        release.setCode,
        release.setName,
        release.releaseDate,
        release.setType,
        release.source,
        JSON.stringify(release.metadata ?? {})
      );
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listSetReleases(database: DatabaseSync): readonly SetRelease[] {
  const rows = database
    .prepare(
      `SELECT
        set_code AS setCode,
        set_name AS setName,
        release_date AS releaseDate,
        set_type AS setType,
        source,
        metadata_json AS metadataJson
      FROM set_releases
      ORDER BY release_date, set_code`
    )
    .all();

  return rows.map((row) => ({
    metadata: parseJson(String(row.metadataJson), {}),
    releaseDate: String(row.releaseDate),
    setCode: String(row.setCode),
    setName: String(row.setName),
    setType: String(row.setType) as StandardSetType,
    source: String(row.source)
  }));
}

export function replaceMetagamePeriods(
  database: DatabaseSync,
  periods: readonly MetaPeriod[],
  configHash: string
): void {
  database.exec("BEGIN;");
  try {
    database.prepare("DELETE FROM metagame_period_assignment_reviews").run();
    database.prepare("DELETE FROM deck_metagame_periods").run();
    database.prepare("DELETE FROM metagame_periods").run();
    const insert = database.prepare(
      `INSERT INTO metagame_periods (
        period_id, model, set_code, set_name, release_date, start_date, end_date,
        sort_order, config_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const period of periods) {
      insert.run(
        period.periodId,
        period.model,
        period.setCode,
        period.setName,
        period.releaseDate,
        period.startDate,
        period.endDate,
        period.sortOrder,
        configHash
      );
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listMetagamePeriods(
  database: DatabaseSync,
  model: MetagamePeriodModel = "standard_set_release"
): readonly MetaPeriod[] {
  const rows = database
    .prepare(
      `SELECT
        period_id AS periodId,
        model,
        set_code AS setCode,
        set_name AS setName,
        release_date AS releaseDate,
        start_date AS startDate,
        end_date AS endDate,
        sort_order AS sortOrder
      FROM metagame_periods
      WHERE model = ?
      ORDER BY sort_order, start_date, period_id`
    )
    .all(model);

  return rows.map((row) => ({
    endDate: String(row.endDate),
    model: String(row.model) as MetagamePeriodModel,
    periodId: String(row.periodId),
    releaseDate: String(row.releaseDate),
    setCode: String(row.setCode),
    setName: String(row.setName),
    sortOrder: Number(row.sortOrder),
    startDate: String(row.startDate)
  }));
}

export function listNormalizedDeckPeriodCandidates(
  database: DatabaseSync
): readonly NormalizedDeckPeriodCandidateRecord[] {
  const rows = database
    .prepare(
      `SELECT deck_id AS deckId, event_date AS eventDate
       FROM normalized_decks
       ORDER BY event_date, deck_id`
    )
    .all();

  return rows.map((row) => ({
    deckId: String(row.deckId),
    eventDate: row.eventDate === null || row.eventDate === undefined ? undefined : String(row.eventDate)
  }));
}

export function replaceDeckMetagamePeriodAssignments(
  database: DatabaseSync,
  assignments: readonly DeckMetagamePeriodAssignmentInput[],
  reviews: readonly MetagamePeriodAssignmentReview[]
): void {
  database.exec("BEGIN;");
  try {
    database.prepare("DELETE FROM deck_metagame_periods").run();
    database.prepare("DELETE FROM metagame_period_assignment_reviews").run();

    const insertAssignment = database.prepare(
      `INSERT INTO deck_metagame_periods (deck_id, period_id)
       VALUES (?, ?)`
    );
    for (const assignment of assignments) {
      insertAssignment.run(assignment.deckId, assignment.periodId);
    }

    const insertReview = database.prepare(
      `INSERT INTO metagame_period_assignment_reviews (
        deck_id, event_date, reason, metadata_json
      )
      VALUES (?, ?, ?, ?)`
    );
    for (const review of reviews) {
      insertReview.run(
        review.deckId ?? null,
        review.eventDate ?? null,
        review.reason,
        JSON.stringify(review.metadata ?? {})
      );
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listDeckMetagamePeriodAssignments(
  database: DatabaseSync
): readonly DeckMetagamePeriodAssignmentRecord[] {
  const rows = database
    .prepare(
      `SELECT deck_id AS deckId, period_id AS periodId, assigned_at AS assignedAt
       FROM deck_metagame_periods
       ORDER BY deck_id`
    )
    .all();

  return rows.map((row) => ({
    assignedAt: String(row.assignedAt),
    deckId: String(row.deckId),
    periodId: String(row.periodId)
  }));
}

export function listMetagamePeriodAssignmentReviews(
  database: DatabaseSync
): readonly MetagamePeriodAssignmentReviewRecord[] {
  const rows = database
    .prepare(
      `SELECT
        id,
        deck_id AS deckId,
        event_date AS eventDate,
        reason,
        metadata_json AS metadataJson,
        created_at AS createdAt
      FROM metagame_period_assignment_reviews
      ORDER BY id`
    )
    .all();

  return rows.map((row) => ({
    createdAt: String(row.createdAt),
    deckId: row.deckId === null || row.deckId === undefined ? undefined : String(row.deckId),
    eventDate: row.eventDate === null || row.eventDate === undefined ? undefined : String(row.eventDate),
    id: Number(row.id),
    metadata: parseJson(String(row.metadataJson), {}),
    reason: String(row.reason)
  }));
}

export function listHistoricalCoverageInputRows(database: DatabaseSync): readonly HistoricalCoverageInputRecord[] {
  const rows = database
    .prepare(
      `SELECT
        nd.deck_id AS deckId,
        dmp.period_id AS periodId,
        nd.source,
        nd.archetype_family AS archetypeFamily
       FROM deck_metagame_periods dmp
       JOIN normalized_decks nd ON nd.deck_id = dmp.deck_id
       ORDER BY dmp.period_id, nd.source, nd.archetype_family, nd.deck_id`
    )
    .all();

  return rows.map((row) => ({
    archetypeFamily: String(row.archetypeFamily),
    deckId: String(row.deckId),
    periodId: String(row.periodId),
    source: String(row.source) as DeckSource
  }));
}

export function replaceHistoricalSourceCoverageRows(
  database: DatabaseSync,
  pipelineRunId: string,
  rows: readonly HistoricalSourceCoverageRow[],
  warnings: readonly HistoricalCoverageWarning[]
): void {
  database.exec("BEGIN;");
  try {
    database.prepare("DELETE FROM historical_source_coverage WHERE pipeline_run_id = ?").run(pipelineRunId);
    database.prepare("DELETE FROM historical_coverage_warnings WHERE pipeline_run_id = ?").run(pipelineRunId);

    const insertRow = database.prepare(
      `INSERT INTO historical_source_coverage (
        pipeline_run_id, period_id, set_code, set_name, period_start_date,
        period_end_date, year, source, archetype_family, deck_count,
        source_status, coverage_status, warning_codes_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of rows) {
      insertRow.run(
        row.pipelineRunId,
        row.periodId,
        row.setCode,
        row.setName,
        row.periodStartDate,
        row.periodEndDate,
        row.year,
        row.source,
        row.archetypeFamily,
        row.deckCount,
        row.sourceStatus,
        row.coverageStatus,
        JSON.stringify(row.warningCodes)
      );
    }

    const insertWarning = database.prepare(
      `INSERT INTO historical_coverage_warnings (
        pipeline_run_id, period_id, source, warning_type, severity, message, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const warning of warnings) {
      insertWarning.run(
        warning.pipelineRunId,
        warning.periodId,
        warning.source ?? null,
        warning.warningType,
        warning.severity,
        warning.message,
        JSON.stringify(warning.metadata ?? {})
      );
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listHistoricalSourceCoverageRows(
  database: DatabaseSync,
  pipelineRunId: string
): readonly HistoricalSourceCoverageRow[] {
  const rows = database
    .prepare(
      `SELECT
        pipeline_run_id AS pipelineRunId,
        period_id AS periodId,
        set_code AS setCode,
        set_name AS setName,
        period_start_date AS periodStartDate,
        period_end_date AS periodEndDate,
        year,
        source,
        archetype_family AS archetypeFamily,
        deck_count AS deckCount,
        source_status AS sourceStatus,
        coverage_status AS coverageStatus,
        warning_codes_json AS warningCodesJson
       FROM historical_source_coverage
       WHERE pipeline_run_id = ?
       ORDER BY
        period_start_date,
        CASE source
          WHEN 'mtgtop8' THEN 0
          WHEN 'mtggoldfish' THEN 1
          WHEN 'mtgo' THEN 2
          ELSE 3
        END,
        archetype_family`
    )
    .all(pipelineRunId);

  return rows.map((row) => ({
    archetypeFamily: String(row.archetypeFamily),
    coverageStatus: String(row.coverageStatus) as HistoricalSourceCoverageRow["coverageStatus"],
    deckCount: Number(row.deckCount),
    periodEndDate: String(row.periodEndDate),
    periodId: String(row.periodId),
    periodStartDate: String(row.periodStartDate),
    pipelineRunId: String(row.pipelineRunId),
    setCode: String(row.setCode),
    setName: String(row.setName),
    source: String(row.source) as DeckSource,
    sourceStatus: String(row.sourceStatus) as HistoricalSourceCoverageStatus,
    warningCodes: parseJsonArray(row.warningCodesJson).filter(isHistoricalCoverageWarningType),
    year: Number(row.year)
  }));
}

export function listHistoricalCoverageWarnings(
  database: DatabaseSync,
  pipelineRunId?: string
): readonly HistoricalCoverageWarningRecord[] {
  const rows = pipelineRunId
    ? database
        .prepare(
          `SELECT
            id,
            pipeline_run_id AS pipelineRunId,
            period_id AS periodId,
            source,
            warning_type AS warningType,
            severity,
            message,
            metadata_json AS metadataJson,
            created_at AS createdAt
           FROM historical_coverage_warnings
           WHERE pipeline_run_id = ?
           ORDER BY id`
        )
        .all(pipelineRunId)
    : database
        .prepare(
          `SELECT
            id,
            pipeline_run_id AS pipelineRunId,
            period_id AS periodId,
            source,
            warning_type AS warningType,
            severity,
            message,
            metadata_json AS metadataJson,
            created_at AS createdAt
           FROM historical_coverage_warnings
           ORDER BY pipeline_run_id, id`
        )
        .all();

  return rows.map((row) => ({
    createdAt: String(row.createdAt),
    id: Number(row.id),
    message: String(row.message),
    metadata: parseJson(String(row.metadataJson), {}),
    periodId: String(row.periodId),
    pipelineRunId: String(row.pipelineRunId),
    severity: String(row.severity) === "fail" ? "fail" : "warn",
    source: row.source === null || row.source === undefined ? undefined : (String(row.source) as DeckSource),
    warningType: String(row.warningType) as HistoricalCoverageWarningType
  }));
}

export function listRawDeckRecords(database: DatabaseSync): readonly RawDeckRecord[] {
  const rows = database
    .prepare(
      `SELECT id, source, source_url AS sourceUrl, event_date AS eventDate, reported_archetype AS reportedArchetype
       FROM raw_decks
       WHERE active = 1
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

export function listPeriodMatrixInputRows(database: DatabaseSync): readonly PeriodMatrixInputRow[] {
  const rows = database
    .prepare(
      `SELECT
        nd.deck_id AS deckId,
        mp.period_id AS periodId,
        mp.set_code AS setCode,
        mp.set_name AS setName,
        mp.start_date AS periodStartDate,
        mp.end_date AS periodEndDate,
        mp.sort_order AS sortOrder,
        nd.archetype_family AS archetypeFamily,
        COALESCE(dw.weight, nd.weight) AS weight,
        ndc.zone AS zone,
        ndc.card_name AS cardName,
        ndc.copies AS copies
      FROM deck_metagame_periods dmp
      JOIN metagame_periods mp ON mp.period_id = dmp.period_id
      JOIN normalized_decks nd ON nd.deck_id = dmp.deck_id
      JOIN normalized_deck_cards ndc ON ndc.deck_id = nd.deck_id
      LEFT JOIN deck_weights dw ON dw.deck_id = nd.deck_id
      ORDER BY mp.sort_order, nd.archetype_family, nd.deck_id, ndc.zone, ndc.position`
    )
    .all();

  return rows.map((row) => ({
    archetypeFamily: String(row.archetypeFamily),
    cardName: String(row.cardName),
    copies: Number(row.copies),
    deckId: String(row.deckId),
    periodEndDate: String(row.periodEndDate),
    periodId: String(row.periodId),
    periodStartDate: String(row.periodStartDate),
    setCode: String(row.setCode),
    setName: String(row.setName),
    sortOrder: Number(row.sortOrder),
    weight: Number(row.weight),
    zone: String(row.zone) === "sideboard" ? "sideboard" : "mainboard"
  }));
}

export function replacePeriodMatrixRows(
  database: DatabaseSync,
  pipelineRunId: string,
  cardRows: readonly CardPeriodMatrixRow[],
  archetypeRows: readonly ArchetypePeriodSummaryRow[]
): void {
  database.exec("BEGIN;");
  try {
    database.prepare("DELETE FROM card_period_matrix WHERE pipeline_run_id = ?").run(pipelineRunId);
    database.prepare("DELETE FROM archetype_period_summaries WHERE pipeline_run_id = ?").run(pipelineRunId);

    const insertCard = database.prepare(
      `INSERT INTO card_period_matrix (
        pipeline_run_id, card_name, period_id, set_code, set_name, period_start_date,
        period_end_date, decks_with_card, total_decks_in_period, metagame_share,
        mainboard_copies, sideboard_copies, archetype_families_json, sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of cardRows) {
      insertCard.run(
        row.pipelineRunId,
        row.cardName,
        row.periodId,
        row.setCode,
        row.setName,
        row.periodStartDate,
        row.periodEndDate,
        row.decksWithCard,
        row.totalDecksInPeriod,
        row.metagameShare,
        row.mainboardCopies,
        row.sideboardCopies,
        JSON.stringify(row.archetypeFamilies),
        row.sortOrder
      );
    }

    const insertArchetype = database.prepare(
      `INSERT INTO archetype_period_summaries (
        pipeline_run_id, archetype_family, period_id, set_code, set_name,
        period_start_date, period_end_date, total_deck_weight, unique_cards,
        representative_cards_json, period_metagame_share, sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of archetypeRows) {
      insertArchetype.run(
        row.pipelineRunId,
        row.archetypeFamily,
        row.periodId,
        row.setCode,
        row.setName,
        row.periodStartDate,
        row.periodEndDate,
        row.totalDeckWeight,
        row.uniqueCards,
        JSON.stringify(row.representativeCards),
        row.periodMetagameShare,
        row.sortOrder
      );
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listPersistedCardPeriodMatrixRows(
  database: DatabaseSync,
  pipelineRunId: string
): readonly CardPeriodMatrixRow[] {
  const rows = database
    .prepare(
      `SELECT
        pipeline_run_id AS pipelineRunId,
        card_name AS cardName,
        period_id AS periodId,
        set_code AS setCode,
        set_name AS setName,
        period_start_date AS periodStartDate,
        period_end_date AS periodEndDate,
        decks_with_card AS decksWithCard,
        total_decks_in_period AS totalDecksInPeriod,
        metagame_share AS metagameShare,
        mainboard_copies AS mainboardCopies,
        sideboard_copies AS sideboardCopies,
        archetype_families_json AS archetypeFamiliesJson,
        sort_order AS sortOrder
      FROM card_period_matrix
      WHERE pipeline_run_id = ?
      ORDER BY sort_order, archetype_families_json, card_name`
    )
    .all(pipelineRunId);

  return rows.map((row) => ({
    archetypeFamilies: parseJsonArray(row.archetypeFamiliesJson),
    cardName: String(row.cardName),
    decksWithCard: Number(row.decksWithCard),
    mainboardCopies: Number(row.mainboardCopies),
    metagameShare: Number(row.metagameShare),
    periodEndDate: String(row.periodEndDate),
    periodId: String(row.periodId),
    periodStartDate: String(row.periodStartDate),
    pipelineRunId: String(row.pipelineRunId),
    setCode: String(row.setCode),
    setName: String(row.setName),
    sideboardCopies: Number(row.sideboardCopies),
    sortOrder: Number(row.sortOrder),
    totalDecksInPeriod: Number(row.totalDecksInPeriod)
  }));
}

export function listPersistedArchetypePeriodSummaryRows(
  database: DatabaseSync,
  pipelineRunId: string
): readonly ArchetypePeriodSummaryRow[] {
  const rows = database
    .prepare(
      `SELECT
        pipeline_run_id AS pipelineRunId,
        archetype_family AS archetypeFamily,
        period_id AS periodId,
        set_code AS setCode,
        set_name AS setName,
        period_start_date AS periodStartDate,
        period_end_date AS periodEndDate,
        total_deck_weight AS totalDeckWeight,
        unique_cards AS uniqueCards,
        representative_cards_json AS representativeCardsJson,
        period_metagame_share AS periodMetagameShare,
        sort_order AS sortOrder
      FROM archetype_period_summaries
      WHERE pipeline_run_id = ?
      ORDER BY sort_order, archetype_family`
    )
    .all(pipelineRunId);

  return rows.map((row) => ({
    archetypeFamily: String(row.archetypeFamily),
    periodEndDate: String(row.periodEndDate),
    periodId: String(row.periodId),
    periodMetagameShare: Number(row.periodMetagameShare),
    periodStartDate: String(row.periodStartDate),
    pipelineRunId: String(row.pipelineRunId),
    representativeCards: parseJsonArray(row.representativeCardsJson),
    setCode: String(row.setCode),
    setName: String(row.setName),
    sortOrder: Number(row.sortOrder),
    totalDeckWeight: Number(row.totalDeckWeight),
    uniqueCards: Number(row.uniqueCards)
  }));
}

export function listHistoricalScoreInputRows(
  database: DatabaseSync,
  pipelineRunId: string
): readonly HistoricalScoreInputRow[] {
  const rows = database
    .prepare(
      `SELECT
        card_name AS cardName,
        period_id AS periodId,
        metagame_share AS metagameShare,
        mainboard_copies AS mainboardCopies,
        sideboard_copies AS sideboardCopies,
        archetype_families_json AS archetypeFamiliesJson
       FROM card_period_matrix
       WHERE pipeline_run_id = ?
       ORDER BY sort_order, card_name`
    )
    .all(pipelineRunId);

  return rows.map((row) => ({
    archetypeFamilies: parseJsonArray(row.archetypeFamiliesJson),
    cardName: String(row.cardName),
    mainboardCopies: Number(row.mainboardCopies),
    metagameShare: Number(row.metagameShare),
    periodId: String(row.periodId),
    sideboardCopies: Number(row.sideboardCopies)
  }));
}

export function replaceHistoricalCardScoreRows(
  database: DatabaseSync,
  pipelineRunId: string,
  rows: readonly HistoricalCardScoreRow[]
): void {
  database.exec("BEGIN;");
  try {
    database.prepare("DELETE FROM historical_card_scores WHERE pipeline_run_id = ?").run(pipelineRunId);
    const insert = database.prepare(
      `INSERT INTO historical_card_scores (
        pipeline_run_id, config_hash, card_name, era_score, peak_score, longevity_score,
        period_variance, archetype_importance_score, glue_score,
        modern_legacy_score, historical_role, explanation, config_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const row of rows) {
      insert.run(
        row.pipelineRunId,
        row.configHash ?? stableId("historical-score-config", JSON.stringify(row.config)),
        row.cardName,
        row.eraScore,
        row.peakScore,
        row.longevityScore,
        row.periodVariance,
        row.archetypeImportanceScore,
        row.glueScore,
        row.modernLegacyScore,
        row.historicalRole,
        row.explanation,
        JSON.stringify(row.config)
      );
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listHistoricalCardScoreRows(
  database: DatabaseSync,
  pipelineRunId: string,
  role?: HistoricalCardRole
): readonly HistoricalCardScoreRow[] {
  const rows = role
    ? database
        .prepare(
          `SELECT *
           FROM historical_card_scores
           WHERE pipeline_run_id = ? AND historical_role = ?
           ORDER BY modern_legacy_score DESC, card_name`
        )
        .all(pipelineRunId, role)
    : database
        .prepare(
          `SELECT *
           FROM historical_card_scores
           WHERE pipeline_run_id = ?
           ORDER BY modern_legacy_score DESC, card_name`
        )
        .all(pipelineRunId);

  return rows.map((row) => ({
    archetypeImportanceScore: Number(row.archetype_importance_score),
    cardName: String(row.card_name),
    configHash: String(row.config_hash),
    config: parseJson(String(row.config_json), {}),
    eraScore: Number(row.era_score),
    explanation: String(row.explanation),
    glueScore: Number(row.glue_score),
    historicalRole: String(row.historical_role) as HistoricalCardRole,
    longevityScore: Number(row.longevity_score),
    modernLegacyScore: Number(row.modern_legacy_score),
    peakScore: Number(row.peak_score),
    periodVariance: Number(row.period_variance),
    pipelineRunId: String(row.pipeline_run_id)
  }));
}

export function replaceArchetypeReconstructionTargets(
  database: DatabaseSync,
  pipelineRunId: string,
  rows: readonly ArchetypeReconstructionTargetRow[]
): void {
  database.exec("BEGIN;");
  try {
    database.prepare("DELETE FROM archetype_reconstruction_targets WHERE pipeline_run_id = ?").run(pipelineRunId);
    const insert = database.prepare(
      `INSERT INTO archetype_reconstruction_targets (
        pipeline_run_id, config_hash, period_id, archetype_family, card_name, target_role, importance
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of rows) {
      insert.run(row.pipelineRunId, row.configHash ?? "", row.periodId, row.archetypeFamily, row.cardName, row.targetRole, row.importance);
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listArchetypeReconstructionTargets(
  database: DatabaseSync,
  pipelineRunId: string
): readonly ArchetypeReconstructionTargetRow[] {
  const rows = database
    .prepare(
      `SELECT
        pipeline_run_id AS pipelineRunId,
        config_hash AS configHash,
        period_id AS periodId,
        archetype_family AS archetypeFamily,
        card_name AS cardName,
        target_role AS targetRole,
        importance
       FROM archetype_reconstruction_targets
       WHERE pipeline_run_id = ?
       ORDER BY period_id, archetype_family, importance DESC, card_name`
    )
    .all(pipelineRunId);

  return rows.map((row) => ({
    archetypeFamily: String(row.archetypeFamily),
    cardName: String(row.cardName),
    configHash: String(row.configHash),
    importance: Number(row.importance),
    periodId: String(row.periodId),
    pipelineRunId: String(row.pipelineRunId),
    targetRole: String(row.targetRole) as ArchetypeReconstructionTargetRow["targetRole"]
  }));
}

export function replaceCubeArchetypeReconstructionRows(
  database: DatabaseSync,
  cubeRunId: string,
  pipelineRunId: string,
  rows: readonly CubeArchetypeReconstructionRow[],
  summary: EcosystemDiversitySummaryRow
): void {
  database.exec("BEGIN;");
  try {
    database.prepare("DELETE FROM cube_archetype_reconstruction WHERE cube_run_id = ? AND pipeline_run_id = ?").run(cubeRunId, pipelineRunId);
    database.prepare("DELETE FROM ecosystem_diversity_summaries WHERE cube_run_id = ? AND pipeline_run_id = ?").run(cubeRunId, pipelineRunId);

    const insertRow = database.prepare(
      `INSERT INTO cube_archetype_reconstruction (
        cube_run_id, pipeline_run_id, config_hash, period_id, archetype_family, reconstruction_score,
        total_importance, included_importance, total_targets, included_targets,
        missing_core_cards_json, warnings_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of rows) {
      insertRow.run(
        row.cubeRunId,
        row.pipelineRunId,
        row.configHash ?? "",
        row.periodId,
        row.archetypeFamily,
        row.reconstructionScore,
        row.totalImportance,
        row.includedImportance,
        row.totalTargets,
        row.includedTargets,
        JSON.stringify(row.missingCoreCards),
        JSON.stringify(row.warnings)
      );
    }

    database
      .prepare(
        `INSERT INTO ecosystem_diversity_summaries (
          cube_run_id, pipeline_run_id, config_hash, archetypes_above_threshold,
          periods_represented, shared_card_efficiency, summary_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        summary.cubeRunId,
        summary.pipelineRunId,
        summary.configHash ?? "",
        summary.archetypesAboveThreshold,
        summary.periodsRepresented,
        summary.sharedCardEfficiency,
        JSON.stringify(summary.summary)
      );

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listCubeArchetypeReconstructionRows(
  database: DatabaseSync,
  cubeRunId: string,
  pipelineRunId: string
): readonly CubeArchetypeReconstructionRow[] {
  const rows = database
    .prepare(
      `SELECT
        cube_run_id AS cubeRunId,
        pipeline_run_id AS pipelineRunId,
        config_hash AS configHash,
        period_id AS periodId,
        archetype_family AS archetypeFamily,
        reconstruction_score AS reconstructionScore,
        total_importance AS totalImportance,
        included_importance AS includedImportance,
        total_targets AS totalTargets,
        included_targets AS includedTargets,
        missing_core_cards_json AS missingCoreCardsJson,
        warnings_json AS warningsJson
       FROM cube_archetype_reconstruction
       WHERE cube_run_id = ? AND pipeline_run_id = ?
       ORDER BY period_id, archetype_family`
    )
    .all(cubeRunId, pipelineRunId);

  return rows.map((row) => ({
    archetypeFamily: String(row.archetypeFamily),
    configHash: String(row.configHash),
    cubeRunId: String(row.cubeRunId),
    includedImportance: Number(row.includedImportance),
    includedTargets: Number(row.includedTargets),
    missingCoreCards: parseJsonArray(row.missingCoreCardsJson),
    periodId: String(row.periodId),
    pipelineRunId: String(row.pipelineRunId),
    reconstructionScore: Number(row.reconstructionScore),
    totalImportance: Number(row.totalImportance),
    totalTargets: Number(row.totalTargets),
    warnings: parseJsonArray(row.warningsJson)
  }));
}

export function getEcosystemDiversitySummary(
  database: DatabaseSync,
  cubeRunId: string,
  pipelineRunId: string
): EcosystemDiversitySummaryRow | undefined {
  const row = database
    .prepare(
      `SELECT
        cube_run_id AS cubeRunId,
        pipeline_run_id AS pipelineRunId,
        config_hash AS configHash,
        archetypes_above_threshold AS archetypesAboveThreshold,
        periods_represented AS periodsRepresented,
        shared_card_efficiency AS sharedCardEfficiency,
        summary_json AS summaryJson
       FROM ecosystem_diversity_summaries
       WHERE cube_run_id = ? AND pipeline_run_id = ?`
    )
    .get(cubeRunId, pipelineRunId);

  if (!row) {
    return undefined;
  }

  return {
    archetypesAboveThreshold: Number(row.archetypesAboveThreshold),
    configHash: String(row.configHash),
    cubeRunId: String(row.cubeRunId),
    periodsRepresented: Number(row.periodsRepresented),
    pipelineRunId: String(row.pipelineRunId),
    sharedCardEfficiency: Number(row.sharedCardEfficiency),
    summary: parseJson(String(row.summaryJson), {})
  };
}

export function upsertHistoricalValidationRun(
  database: DatabaseSync,
  input: HistoricalValidationRunInput
): void {
  database
    .prepare(
      `INSERT INTO historical_validation_runs (
        id, cube_run_id, pipeline_run_id, status, config_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        cube_run_id = excluded.cube_run_id,
        pipeline_run_id = excluded.pipeline_run_id,
        status = excluded.status,
        config_json = excluded.config_json`
    )
    .run(input.id, input.cubeRunId, input.pipelineRunId, input.status, JSON.stringify(input.config), new Date().toISOString());
}

export function replaceHistoricalValidationRows(
  database: DatabaseSync,
  validationRunId: string,
  metrics: readonly HistoricalValidationMetricRow[],
  warnings: readonly HistoricalValidationWarningRow[]
): void {
  database.exec("BEGIN;");
  try {
    database.prepare("DELETE FROM historical_validation_metrics WHERE validation_run_id = ?").run(validationRunId);
    database.prepare("DELETE FROM historical_validation_warnings WHERE validation_run_id = ?").run(validationRunId);

    const insertMetric = database.prepare(
      `INSERT INTO historical_validation_metrics (
        validation_run_id, metric_key, label, value, metadata_json
      )
      VALUES (?, ?, ?, ?, ?)`
    );
    for (const metric of metrics) {
      insertMetric.run(
        metric.validationRunId,
        metric.metricKey,
        metric.label,
        metric.value,
        JSON.stringify(metric.metadata ?? {})
      );
    }

    const insertWarning = database.prepare(
      `INSERT INTO historical_validation_warnings (
        validation_run_id, cube_run_id, pipeline_run_id, severity, code, message, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const warning of warnings) {
      insertWarning.run(
        warning.validationRunId,
        warning.cubeRunId,
        warning.pipelineRunId,
        warning.severity,
        warning.code,
        warning.message,
        JSON.stringify(warning.metadata ?? {})
      );
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listHistoricalValidationMetrics(
  database: DatabaseSync,
  validationRunId: string
): readonly HistoricalValidationMetricRow[] {
  const rows = database
    .prepare(
      `SELECT validation_run_id AS validationRunId, metric_key AS metricKey, label, value, metadata_json AS metadataJson
       FROM historical_validation_metrics
       WHERE validation_run_id = ?
       ORDER BY metric_key`
    )
    .all(validationRunId);

  return rows.map((row) => ({
    label: String(row.label),
    metadata: parseJson(String(row.metadataJson), {}),
    metricKey: String(row.metricKey),
    validationRunId: String(row.validationRunId),
    value: Number(row.value)
  }));
}

export function listHistoricalValidationWarnings(
  database: DatabaseSync,
  validationRunId?: string
): readonly PersistedHistoricalValidationWarningRecord[] {
  const rows = validationRunId
    ? database
        .prepare(
          `SELECT
            id,
            validation_run_id AS validationRunId,
            cube_run_id AS cubeRunId,
            pipeline_run_id AS pipelineRunId,
            severity,
            code,
            message,
            metadata_json AS metadataJson,
            created_at AS createdAt
           FROM historical_validation_warnings
           WHERE validation_run_id = ?
           ORDER BY severity DESC, code, id`
        )
        .all(validationRunId)
    : database
        .prepare(
          `SELECT
            id,
            validation_run_id AS validationRunId,
            cube_run_id AS cubeRunId,
            pipeline_run_id AS pipelineRunId,
            severity,
            code,
            message,
            metadata_json AS metadataJson,
            created_at AS createdAt
           FROM historical_validation_warnings
           ORDER BY validation_run_id, severity DESC, code, id`
        )
        .all();

  return rows.map((row) => ({
    code: String(row.code),
    createdAt: String(row.createdAt),
    cubeRunId: String(row.cubeRunId),
    id: Number(row.id),
    message: String(row.message),
    metadata: parseJson(String(row.metadataJson), {}),
    pipelineRunId: String(row.pipelineRunId),
    severity: String(row.severity) === "fail" ? "fail" : "warn",
    validationRunId: String(row.validationRunId)
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

export function upsertValidationRun(database: DatabaseSync, input: ValidationRunInput): void {
  database
    .prepare(
      `INSERT INTO validation_runs (id, cube_run_id, config_json, created_at, total_cards, status)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         cube_run_id = excluded.cube_run_id,
         config_json = excluded.config_json,
         created_at = excluded.created_at,
         total_cards = excluded.total_cards,
         status = excluded.status`
    )
    .run(
      input.id,
      input.cubeRunId,
      JSON.stringify(input.config),
      input.createdAt ?? new Date().toISOString(),
      input.totalCards,
      input.status
    );
}

export function replaceValidationWarnings(
  database: DatabaseSync,
  validationRunId: string,
  rows: readonly ValidationWarningInput[]
): void {
  database.exec("BEGIN;");
  try {
    database.prepare("DELETE FROM validation_warnings WHERE validation_run_id = ?").run(validationRunId);
    const insert = database.prepare(
      `INSERT INTO validation_warnings (validation_run_id, level, code, message, metadata_json)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const row of rows) {
      insert.run(row.validationRunId, row.level, row.code, row.message, JSON.stringify(row.metadata ?? {}));
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listValidationWarnings(database: DatabaseSync, validationRunId: string): readonly ValidationWarningInput[] {
  const rows = database
    .prepare(
      `SELECT validation_run_id AS validationRunId, level, code, message, metadata_json AS metadataJson
       FROM validation_warnings
       WHERE validation_run_id = ?
       ORDER BY level DESC, code, message`
    )
    .all(validationRunId);

  return rows.map((row) => ({
    code: String(row.code),
    level: normalizeWarningLevel(String(row.level)),
    message: String(row.message),
    metadata: parseJsonObject(row.metadataJson),
    validationRunId: String(row.validationRunId)
  }));
}

export function replaceValidationMetrics(
  database: DatabaseSync,
  validationRunId: string,
  rows: readonly ValidationMetricInput[]
): void {
  database.exec("BEGIN;");
  try {
    database.prepare("DELETE FROM validation_metrics WHERE validation_run_id = ?").run(validationRunId);
    const insert = database.prepare(
      `INSERT INTO validation_metrics (validation_run_id, metric_key, label, value, metadata_json)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const row of rows) {
      insert.run(row.validationRunId, row.metricKey, row.label, row.value, JSON.stringify(row.metadata ?? {}));
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listValidationMetrics(database: DatabaseSync, validationRunId: string): readonly ValidationMetricInput[] {
  const rows = database
    .prepare(
      `SELECT validation_run_id AS validationRunId, metric_key AS metricKey, label, value, metadata_json AS metadataJson
       FROM validation_metrics
       WHERE validation_run_id = ?
       ORDER BY metric_key`
    )
    .all(validationRunId);

  return rows.map((row) => ({
    label: String(row.label),
    metadata: parseJsonObject(row.metadataJson),
    metricKey: String(row.metricKey),
    validationRunId: String(row.validationRunId),
    value: Number(row.value)
  }));
}

export function replaceValidationZeroSupportCards(
  database: DatabaseSync,
  validationRunId: string,
  rows: readonly ValidationZeroSupportCardInput[]
): void {
  database.exec("BEGIN;");
  try {
    database.prepare("DELETE FROM validation_zero_support_cards WHERE validation_run_id = ?").run(validationRunId);
    const insert = database.prepare(
      `INSERT INTO validation_zero_support_cards (validation_run_id, card_name, section, position, reason)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const row of rows) {
      insert.run(row.validationRunId, row.cardName, row.section, row.position, row.reason);
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function listValidationZeroSupportCards(
  database: DatabaseSync,
  validationRunId: string
): readonly ValidationZeroSupportCardInput[] {
  const rows = database
    .prepare(
      `SELECT validation_run_id AS validationRunId, card_name AS cardName, section, position, reason
       FROM validation_zero_support_cards
       WHERE validation_run_id = ?
       ORDER BY position, card_name`
    )
    .all(validationRunId);

  return rows.map((row) => ({
    cardName: String(row.cardName),
    position: Number(row.position),
    reason: String(row.reason),
    section: String(row.section),
    validationRunId: String(row.validationRunId)
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

function isHistoricalCoverageWarningType(value: string): value is HistoricalCoverageWarningType {
  return value === "empty_period" || value === "thin_period" || value === "missing_source_coverage";
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") {
    return fallback;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function normalizeWarningLevel(value: string): "pass" | "warn" | "fail" {
  if (value === "fail" || value === "warn") {
    return value;
  }

  return "pass";
}
