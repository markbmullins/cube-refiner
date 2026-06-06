import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

export type DatabaseStatusSummary = {
  readonly schemaMigrations: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
  readonly latestPipelineRun?: {
    readonly id: string;
    readonly status: string;
    readonly startedAt: string;
    readonly completedAt?: string;
  };
  readonly latestPipelineStages: readonly {
    readonly stage: string;
    readonly status: string;
    readonly rowCount: number;
    readonly completedAt?: string;
  }[];
  readonly configProfiles: number;
  readonly outputArtifacts: number;
  readonly staleArtifacts: number;
  readonly pendingReviewItems: number;
  readonly readyForPipeline: boolean;
};

export type ManualReviewQueue =
  | "unresolved_cards"
  | "archetype_gaps"
  | "dedupe_ambiguities"
  | "period_assignments"
  | "historical_coverage"
  | "historical_validation"
  | "collection_dates"
  | "parasitic_cards"
  | "validation_warnings"
  | "zero_support_cards";

export type ManualReviewItem = {
  readonly queue: ManualReviewQueue;
  readonly item: string;
  readonly detail: string;
  readonly metadata: Readonly<Record<string, unknown>>;
};

export type OutputArtifactRecord = {
  readonly id: string;
  readonly pipelineRunId?: string;
  readonly stage: string;
  readonly path: string;
  readonly format: string;
  readonly contentHash: string;
  readonly generatedAt: string;
  readonly existsOnDisk: boolean;
};

export type ConfigProfileRecord = {
  readonly name: string;
  readonly configHash: string;
  readonly updatedAt: string;
};

export function getDatabaseStatus(database: DatabaseSync): DatabaseStatusSummary {
  const schemaMigrations = database
    .prepare("SELECT id FROM schema_migrations ORDER BY id")
    .all()
    .map((row) => String(row.id));
  const counts = Object.fromEntries(
    [
      "source_snapshots",
      "raw_decks",
      "normalized_decks",
      "cards",
      "card_name_mappings",
      "archetype_mappings",
      "dedupe_clusters",
      "deck_weights",
      "card_archetype_matrix",
      "card_scores",
      "candidate_pool_cards",
      "cube_runs",
      "validation_runs",
      "set_releases",
      "metagame_periods",
      "deck_metagame_periods",
      "metagame_period_assignment_reviews",
      "historical_source_coverage",
      "historical_coverage_warnings",
      "card_period_matrix",
      "archetype_period_summaries",
      "historical_card_scores",
      "archetype_reconstruction_targets",
      "cube_archetype_reconstruction",
      "ecosystem_diversity_summaries",
      "historical_validation_runs",
      "historical_validation_metrics",
      "historical_validation_warnings",
      "collection_date_reviews",
      "output_artifacts"
    ].map((table) => [table, tableCount(database, table)])
  );
  const latestPipelineRun = latestRun(database);
  const latestPipelineStages = latestPipelineRun ? stageRows(database, latestPipelineRun.id) : [];
  const configProfiles = tableCount(database, "config_profiles");
  const artifacts = listOutputArtifacts(database);
  const pendingReviewItems = listManualReviewItems(database).length;

  return {
    configProfiles,
    counts,
    latestPipelineRun,
    latestPipelineStages,
    outputArtifacts: artifacts.length,
    pendingReviewItems,
    readyForPipeline: (counts.raw_decks ?? 0) > 0 && (counts.cards ?? 0) > 0,
    schemaMigrations,
    staleArtifacts: artifacts.filter((artifact) => !artifact.existsOnDisk).length
  };
}

export function listManualReviewItems(
  database: DatabaseSync,
  queue?: ManualReviewQueue
): readonly ManualReviewItem[] {
  const queues: readonly ManualReviewQueue[] = queue
    ? [queue]
    : [
        "unresolved_cards",
        "archetype_gaps",
        "dedupe_ambiguities",
        "period_assignments",
        "historical_coverage",
        "historical_validation",
        "collection_dates",
        "parasitic_cards",
        "validation_warnings",
        "zero_support_cards"
      ];

  return queues.flatMap((entry) => listQueue(database, entry));
}

export function listOutputArtifacts(
  database: DatabaseSync,
  pipelineRunId?: string
): readonly OutputArtifactRecord[] {
  const rows = pipelineRunId
    ? database
        .prepare(
          `SELECT id, pipeline_run_id AS pipelineRunId, stage, path, format, content_hash AS contentHash, generated_at AS generatedAt
           FROM output_artifacts
           WHERE pipeline_run_id = ?
           ORDER BY generated_at DESC, stage, path`
        )
        .all(pipelineRunId)
    : database
        .prepare(
          `SELECT id, pipeline_run_id AS pipelineRunId, stage, path, format, content_hash AS contentHash, generated_at AS generatedAt
           FROM output_artifacts
           ORDER BY generated_at DESC, stage, path`
        )
        .all();

  return rows.map((row) => ({
    contentHash: String(row.contentHash),
    existsOnDisk: existsSync(String(row.path)),
    format: String(row.format),
    generatedAt: String(row.generatedAt),
    id: String(row.id),
    path: String(row.path),
    pipelineRunId: row.pipelineRunId === null || row.pipelineRunId === undefined ? undefined : String(row.pipelineRunId),
    stage: String(row.stage)
  }));
}

export function listConfigProfiles(database: DatabaseSync): readonly ConfigProfileRecord[] {
  const rows = database
    .prepare("SELECT name, config_hash AS configHash, updated_at AS updatedAt FROM config_profiles ORDER BY name")
    .all();

  return rows.map((row) => ({
    configHash: String(row.configHash),
    name: String(row.name),
    updatedAt: String(row.updatedAt)
  }));
}

export function runIntegrityCheck(database: DatabaseSync): readonly string[] {
  const rows = database.prepare("PRAGMA integrity_check").all();
  return rows.map((row) => String(row.integrity_check));
}

function tableCount(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  return Number(row?.count ?? 0);
}

function latestRun(database: DatabaseSync): DatabaseStatusSummary["latestPipelineRun"] {
  const row = database
    .prepare(
      `SELECT id, status, started_at AS startedAt, completed_at AS completedAt
       FROM pipeline_runs
       ORDER BY started_at DESC, id DESC
       LIMIT 1`
    )
    .get();

  if (!row) {
    return undefined;
  }

  return {
    completedAt: row.completedAt === null || row.completedAt === undefined ? undefined : String(row.completedAt),
    id: String(row.id),
    startedAt: String(row.startedAt),
    status: String(row.status)
  };
}

function stageRows(database: DatabaseSync, pipelineRunId: string): DatabaseStatusSummary["latestPipelineStages"] {
  const rows = database
    .prepare(
      `SELECT stage, status, row_count AS rowCount, completed_at AS completedAt
       FROM pipeline_stage_runs
       WHERE pipeline_run_id = ?
       ORDER BY started_at, stage`
    )
    .all(pipelineRunId);

  return rows.map((row) => ({
    completedAt: row.completedAt === null || row.completedAt === undefined ? undefined : String(row.completedAt),
    rowCount: Number(row.rowCount),
    stage: String(row.stage),
    status: String(row.status)
  }));
}

function listQueue(database: DatabaseSync, queue: ManualReviewQueue): readonly ManualReviewItem[] {
  if (queue === "unresolved_cards") {
    return database
      .prepare(
        `SELECT raw_name AS item, source_context_json AS metadataJson
         FROM card_name_mappings
         WHERE status = 'unresolved'
         ORDER BY raw_name`
      )
      .all()
      .map((row) => reviewItem(queue, String(row.item), "Unresolved card name", row.metadataJson));
  }

  if (queue === "archetype_gaps") {
    return database
      .prepare(
        `SELECT reported_label AS item, audit_status AS detail, archetype, archetype_family AS archetypeFamily
         FROM archetype_mappings
         WHERE audit_status != 'mapped'
         ORDER BY audit_status, reported_label`
      )
      .all()
      .map((row) =>
        reviewItem(queue, String(row.item), `Archetype mapping is ${String(row.detail)}`, {
          archetype: row.archetype,
          archetypeFamily: row.archetypeFamily
        })
      );
  }

  if (queue === "dedupe_ambiguities") {
    return database
      .prepare(
        `SELECT cluster_id AS item, explanation, archetype_family AS archetypeFamily, event_month AS eventMonth
         FROM dedupe_clusters
         WHERE strategy = 'near'
         ORDER BY event_month, archetype_family, cluster_id`
      )
      .all()
      .map((row) =>
        reviewItem(queue, String(row.item), String(row.explanation), {
          archetypeFamily: row.archetypeFamily,
          eventMonth: row.eventMonth
        })
      );
  }

  if (queue === "parasitic_cards") {
    return database
      .prepare(
        `SELECT card_name AS item, explanation, pipeline_run_id AS pipelineRunId, score
         FROM candidate_pool_cards
         WHERE pool = 'parasitic_review'
         ORDER BY score DESC, card_name`
      )
      .all()
      .map((row) =>
        reviewItem(queue, String(row.item), String(row.explanation), {
          pipelineRunId: row.pipelineRunId,
          score: row.score
        })
      );
  }

  if (queue === "period_assignments") {
    return database
      .prepare(
        `SELECT
          id,
          deck_id AS deckId,
          event_date AS eventDate,
          reason,
          metadata_json AS metadataJson
         FROM metagame_period_assignment_reviews
         ORDER BY id`
      )
      .all()
      .map((row) =>
        reviewItem(queue, String(row.deckId ?? `review-${String(row.id)}`), `Period assignment ${String(row.reason)}`, {
          ...parseJsonObject(row.metadataJson),
          eventDate: row.eventDate
        })
      );
  }

  if (queue === "historical_coverage") {
    return database
      .prepare(
        `SELECT
          id,
          pipeline_run_id AS pipelineRunId,
          period_id AS periodId,
          source,
          warning_type AS warningType,
          severity,
          message,
          metadata_json AS metadataJson
         FROM historical_coverage_warnings
         ORDER BY pipeline_run_id, id`
      )
      .all()
      .map((row) =>
        reviewItem(queue, String(row.source ?? row.periodId), String(row.message), {
          ...parseJsonObject(row.metadataJson),
          periodId: row.periodId,
          pipelineRunId: row.pipelineRunId,
          severity: row.severity,
          warningType: row.warningType
        })
      );
  }

  if (queue === "historical_validation") {
    return database
      .prepare(
        `SELECT
          id,
          validation_run_id AS validationRunId,
          cube_run_id AS cubeRunId,
          pipeline_run_id AS pipelineRunId,
          severity,
          code,
          message,
          metadata_json AS metadataJson
         FROM historical_validation_warnings
         ORDER BY validation_run_id, severity DESC, code, id`
      )
      .all()
      .map((row) =>
        reviewItem(queue, String(row.code), String(row.message), {
          ...parseJsonObject(row.metadataJson),
          cubeRunId: row.cubeRunId,
          pipelineRunId: row.pipelineRunId,
          severity: row.severity,
          validationRunId: row.validationRunId
        })
      );
  }

  if (queue === "collection_dates") {
    return database
      .prepare(
        `SELECT
          id,
          source,
          source_url AS sourceUrl,
          event_date AS eventDate,
          reason,
          metadata_json AS metadataJson
         FROM collection_date_reviews
         ORDER BY id`
      )
      .all()
      .map((row) =>
        reviewItem(queue, String(row.sourceUrl), `Collection date ${String(row.reason)}`, {
          ...parseJsonObject(row.metadataJson),
          eventDate: row.eventDate,
          source: row.source
        })
      );
  }

  if (queue === "validation_warnings") {
    return database
      .prepare(
        `SELECT validation_run_id AS validationRunId, code, message, metadata_json AS metadataJson
         FROM validation_warnings
         WHERE level IN ('warn', 'fail')
         ORDER BY validation_run_id, code`
      )
      .all()
      .map((row) =>
        reviewItem(queue, String(row.code), String(row.message), {
          ...parseJsonObject(row.metadataJson),
          validationRunId: row.validationRunId
        })
      );
  }

  return database
    .prepare(
      `SELECT validation_run_id AS validationRunId, card_name AS item, section, position, reason
       FROM validation_zero_support_cards
       ORDER BY validation_run_id, position, card_name`
    )
    .all()
    .map((row) =>
      reviewItem(queue, String(row.item), "Cube card has zero archetype support", {
        position: row.position,
        reason: row.reason,
        section: row.section,
        validationRunId: row.validationRunId
      })
    );
}

function reviewItem(
  queue: ManualReviewQueue,
  item: string,
  detail: string,
  metadata: unknown
): ManualReviewItem {
  return {
    detail,
    item,
    metadata: typeof metadata === "string" ? parseJsonObject(metadata) : objectMetadata(metadata),
    queue
  };
}

function objectMetadata(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseJsonObject(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "string") {
    return {};
  }

  try {
    return objectMetadata(JSON.parse(value) as unknown);
  } catch {
    return {};
  }
}
