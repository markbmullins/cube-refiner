import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { upsertSourceSnapshot } from "../db/index.js";
import type { DeckSource, RawDeck } from "../types/contracts.js";
import type { Fetcher, SnapshotFetchRequest, SnapshotFetchResult, SnapshotStore } from "./types.js";

export type CreateSnapshotStoreOptions = {
  readonly database: DatabaseSync;
  readonly fetcher: Fetcher;
  readonly rawDataDir: string;
};

export function createSnapshotStore(options: CreateSnapshotStoreOptions): SnapshotStore {
  return {
    fetchText: (request) => fetchTextSnapshot(options, request),
    writeParsedDecks: (source, label, decks) => writeParsedDecks(options.rawDataDir, source, label, decks)
  };
}

async function fetchTextSnapshot(
  options: CreateSnapshotStoreOptions,
  request: SnapshotFetchRequest
): Promise<SnapshotFetchResult> {
  const extension = request.extension ?? "html";
  const filePath = path.join(
    options.rawDataDir,
    request.source,
    "snapshots",
    `${sanitizePathSegment(request.cacheKey ?? request.url)}.${extension}`
  );
  mkdirSync(path.dirname(filePath), { recursive: true });

  if (existsSync(filePath) && request.refresh !== true) {
    const body = readFileSync(filePath, "utf8");
    const contentHash = hashContent(body);
    const snapshotId = upsertSourceSnapshot(options.database, {
      contentHash,
      fetchedAt: new Date().toISOString(),
      metadata: { ...objectMetadata(request.metadata), fromCache: true },
      rawPath: filePath,
      source: request.source,
      sourceUrl: request.url
    });

    return {
      body,
      contentHash,
      filePath,
      fromCache: true,
      snapshotId,
      source: request.source,
      sourceUrl: request.url
    };
  }

  const response = await options.fetcher(request.url);
  const body = await response.text();
  writeFileSync(filePath, body);
  const contentHash = hashContent(body);
  const snapshotId = upsertSourceSnapshot(options.database, {
    contentHash,
    error: response.ok ? undefined : `HTTP ${response.status}`,
    fetchedAt: new Date().toISOString(),
    httpStatus: response.status,
    metadata: { ...objectMetadata(request.metadata), fromCache: false },
    rawPath: filePath,
    source: request.source,
    sourceUrl: request.url
  });

  return {
    body,
    contentHash,
    filePath,
    fromCache: false,
    httpStatus: response.status,
    snapshotId,
    source: request.source,
    sourceUrl: request.url
  };
}

function writeParsedDecks(rawDataDir: string, source: DeckSource, label: string, decks: readonly RawDeck[]): string {
  const filePath = path.join(rawDataDir, source, "parsed", `${sanitizePathSegment(label)}.json`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(decks, null, 2)}\n`);
  return filePath;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function sanitizePathSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);

  return sanitized.length > 0 ? sanitized : "snapshot";
}

function objectMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return metadata as Record<string, unknown>;
}
