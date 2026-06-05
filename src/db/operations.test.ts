import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "./connection.js";
import { applyMigrations } from "./migrations.js";
import {
  listConfigProfiles,
  listManualReviewItems,
  listOutputArtifacts,
  getDatabaseStatus,
  runIntegrityCheck
} from "./operations.js";
import {
  registerOutputArtifact,
  upsertCard,
  upsertCardNameMapping,
  upsertConfigProfile,
  upsertPipelineRun
} from "./repository.js";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("SQLite operations", () => {
  it("lists artifact registry entries and saved config profiles", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    upsertPipelineRun(database, {
      configHash: "hash",
      id: "ops-run",
      status: "completed"
    });
    const artifactPath = path.join(mkdtempSync(path.join(os.tmpdir(), "cube-refiner-ops-")), "cards_ranked.csv");
    writeFileSync(artifactPath, "card_name,cube_score\nLightning Bolt,1\n");
    registerOutputArtifact(database, {
      contentHash: "content-hash",
      format: "csv",
      path: artifactPath,
      pipelineRunId: "ops-run",
      sourceMetadata: { query: "card_scores" },
      stage: "score:cards"
    });
    upsertConfigProfile(database, {
      config: { stage: "score:cards" },
      configHash: "config-hash",
      name: "score:test"
    });

    expect(listOutputArtifacts(database, "ops-run")).toEqual([
      {
        contentHash: "content-hash",
        existsOnDisk: true,
        format: "csv",
        generatedAt: expect.any(String),
        id: expect.any(String),
        path: artifactPath,
        pipelineRunId: "ops-run",
        stage: "score:cards"
      }
    ]);
    expect(listConfigProfiles(database)).toEqual([
      {
        configHash: "config-hash",
        name: "score:test",
        updatedAt: expect.any(String)
      }
    ]);
  });

  it("summarizes database status and manual review queues", () => {
    database = openDatabase({ path: ":memory:" });
    applyMigrations(database);
    upsertCard(database, {
      canonicalName: "Lightning Bolt",
      colors: ["R"],
      colorIdentity: ["R"],
      manaValue: 1,
      typeLine: "Instant"
    });
    upsertCardNameMapping(database, {
      rawName: "Lightening Bolt",
      sourceContext: { rawDeckId: "deck-1" },
      status: "unresolved"
    });

    const reviewItems = listManualReviewItems(database, "unresolved_cards");
    const status = getDatabaseStatus(database);

    expect(reviewItems).toEqual([
      {
        detail: "Unresolved card name",
        item: "Lightening Bolt",
        metadata: { rawDeckId: "deck-1" },
        queue: "unresolved_cards"
      }
    ]);
    expect(status.counts.cards).toBe(1);
    expect(status.pendingReviewItems).toBe(1);
    expect(status.schemaMigrations).toContain("0003_pipeline_lineage_artifacts");
    expect(runIntegrityCheck(database)).toEqual(["ok"]);
  });
});
