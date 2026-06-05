import type { DatabaseSync } from "node:sqlite";

import type { ProjectPaths } from "../config/paths.js";
import type { DeckSource, RawDeck } from "../types/contracts.js";

export type CollectorLogger = {
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
  readonly error: (message: string) => void;
};

export type FetcherResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
};

export type Fetcher = (url: string) => Promise<FetcherResponse>;

export type SnapshotFetchRequest = {
  readonly source: DeckSource;
  readonly url: string;
  readonly cacheKey?: string;
  readonly extension?: string;
  readonly refresh?: boolean;
  readonly metadata?: unknown;
};

export type SnapshotFetchResult = {
  readonly snapshotId: string;
  readonly source: DeckSource;
  readonly sourceUrl: string;
  readonly filePath: string;
  readonly body: string;
  readonly contentHash: string;
  readonly fromCache: boolean;
  readonly httpStatus?: number;
};

export type SnapshotStore = {
  readonly fetchText: (request: SnapshotFetchRequest) => Promise<SnapshotFetchResult>;
  readonly writeParsedDecks: (source: DeckSource, label: string, decks: readonly RawDeck[]) => string;
};

export type CollectorContext = {
  readonly database: DatabaseSync;
  readonly fetcher: Fetcher;
  readonly logger: CollectorLogger;
  readonly paths: ProjectPaths;
  readonly refresh: boolean;
  readonly snapshotStore: SnapshotStore;
};

export type DeckCollector = {
  readonly source: DeckSource;
  readonly collect: (context: CollectorContext) => Promise<readonly RawDeck[]>;
};

export type CollectorRunSummary = {
  readonly source: DeckSource;
  readonly deckCount: number;
  readonly parsedOutputPath: string;
};
