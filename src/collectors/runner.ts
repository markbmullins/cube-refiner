import { openDatabase, applyMigrations, upsertRawDeck } from "../db/index.js";
import type { DeckSource, RawDeck } from "../types/contracts.js";
import { defaultProjectPaths } from "../config/paths.js";
import { createSnapshotStore } from "./snapshotStore.js";
import { allCollectorSources, getCollectors } from "./registry.js";
import type { CollectorLogger, CollectorRunSummary, DeckCollector, Fetcher } from "./types.js";

export type RunCollectorsOptions = {
  readonly databasePath?: string;
  readonly fetcher?: Fetcher;
  readonly logger?: CollectorLogger;
  readonly rawDataDir?: string;
  readonly refresh?: boolean;
  readonly sources?: readonly DeckSource[];
};

export async function runCollectors(options: RunCollectorsOptions = {}): Promise<readonly CollectorRunSummary[]> {
  const database = openDatabase({ path: options.databasePath ?? defaultProjectPaths.sqliteDatabasePath });
  const paths = {
    ...defaultProjectPaths,
    rawDataDir: options.rawDataDir ?? defaultProjectPaths.rawDataDir,
    sqliteDatabasePath: options.databasePath ?? defaultProjectPaths.sqliteDatabasePath
  };
  const logger = options.logger ?? consoleLogger;
  const fetcher = options.fetcher ?? defaultFetcher;

  try {
    applyMigrations(database);
    const snapshotStore = createSnapshotStore({
      database,
      fetcher,
      rawDataDir: paths.rawDataDir
    });
    const collectors = getCollectors(options.sources ?? allCollectorSources);
    const summaries: CollectorRunSummary[] = [];

    for (const collector of collectors) {
      summaries.push(
        await runCollector(collector, {
          database,
          fetcher,
          logger,
          paths,
          refresh: options.refresh === true,
          snapshotStore
        })
      );
    }

    return summaries;
  } finally {
    database.close();
  }
}

async function runCollector(
  collector: DeckCollector,
  context: Parameters<DeckCollector["collect"]>[0]
): Promise<CollectorRunSummary> {
  context.logger.info(`Collecting ${collector.source} decklists...`);
  const decks = await collector.collect(context);
  persistRawDecks(context.database, decks);
  const parsedOutputPath = context.snapshotStore.writeParsedDecks(
    collector.source,
    new Date().toISOString(),
    decks
  );
  context.logger.info(`Collected ${decks.length} ${collector.source} decklists.`);

  return {
    deckCount: decks.length,
    parsedOutputPath,
    source: collector.source
  };
}

export function persistRawDecks(database: Parameters<typeof upsertRawDeck>[0], decks: readonly RawDeck[]): void {
  for (const deck of decks) {
    upsertRawDeck(database, deck);
  }
}

const consoleLogger: CollectorLogger = {
  error: (message) => console.error(message),
  info: (message) => console.log(message),
  warn: (message) => console.warn(message)
};

const defaultFetcher: Fetcher = async (url) => {
  const response = await fetch(url);
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text()
  };
};
