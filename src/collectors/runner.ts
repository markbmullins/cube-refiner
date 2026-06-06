import { parseHistoricalDateRange, isDateInHistoricalRange } from "../config/historical.js";
import { openDatabase, applyMigrations, insertCollectionDateReview, upsertRawDeck } from "../db/index.js";
import type { DeckSource, RawDeck } from "../types/contracts.js";
import { defaultProjectPaths } from "../config/paths.js";
import { createSnapshotStore } from "./snapshotStore.js";
import { allCollectorSources, getCollectors } from "./registry.js";
import type { CollectorLogger, CollectorRunSummary, DeckCollector, Fetcher } from "./types.js";

export type CollectionDateHandling = "discard" | "quarantine" | "persist_inactive";

export type CollectionDatePolicy = {
  readonly missingDateHandling: CollectionDateHandling;
  readonly invalidDateHandling: CollectionDateHandling;
  readonly outOfRangeHandling: CollectionDateHandling;
};

export type SourceCollectionPolicy = {
  readonly allowArchiveDiscovery?: boolean;
  readonly discoveryOptions?: Readonly<Record<string, string>>;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
};

export type RunCollectorsOptions = {
  readonly collectionDatePolicy?: Partial<CollectionDatePolicy>;
  readonly collectorOptions?: Readonly<Record<string, string | undefined>>;
  readonly databasePath?: string;
  readonly fetcher?: Fetcher;
  readonly logger?: CollectorLogger;
  readonly rawDataDir?: string;
  readonly refresh?: boolean;
  readonly sourcePolicies?: Partial<Record<DeckSource, SourceCollectionPolicy>>;
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
        await runCollector(
          collector,
          {
            database,
            fetcher,
            logger,
            options: collectorOptionsFor(collector.source, options.collectorOptions ?? {}, options.sourcePolicies?.[collector.source]),
            paths,
            refresh: options.refresh === true,
            snapshotStore
          },
          options.collectionDatePolicy,
          options.sourcePolicies?.[collector.source]
        )
      );
    }

    return summaries;
  } finally {
    database.close();
  }
}

async function runCollector(
  collector: DeckCollector,
  context: Parameters<DeckCollector["collect"]>[0],
  policy?: Partial<CollectionDatePolicy>,
  sourcePolicy?: SourceCollectionPolicy
): Promise<CollectorRunSummary> {
  context.logger.info(`Collecting ${collector.source} decklists...`);
  const decks = filterDecksForSourcePolicy(await collector.collect(context), sourcePolicy);
  const filtered = filterDecksForHistoricalDateRange(context.database, decks, {
    endDate: context.options.endDate,
    policy,
    startDate: context.options.startDate
  });
  persistRawDecks(context.database, filtered.included);
  const parsedOutputPath = context.snapshotStore.writeParsedDecks(
    collector.source,
    new Date().toISOString(),
    decks
  );
  if (filtered.excluded > 0) {
    context.logger.warn(`Excluded ${filtered.excluded} ${collector.source} decklists outside the historical date range.`);
  }
  context.logger.info(`Collected ${filtered.included.length} active ${collector.source} decklists.`);

  return {
    deckCount: filtered.included.length,
    parsedOutputPath,
    source: collector.source
  };
}

function collectorOptionsFor(
  source: DeckSource,
  collectorOptions: Readonly<Record<string, string | undefined>>,
  sourcePolicy: SourceCollectionPolicy | undefined
): Readonly<Record<string, string | undefined>> {
  return {
    ...collectorOptions,
    ...(sourcePolicy?.discoveryOptions ?? {}),
    allowArchiveDiscovery: String(sourcePolicy?.allowArchiveDiscovery ?? true),
    source
  };
}

function filterDecksForSourcePolicy(
  decks: readonly RawDeck[],
  sourcePolicy: SourceCollectionPolicy | undefined
): readonly RawDeck[] {
  const include = sourcePolicy?.include ?? [];
  const exclude = sourcePolicy?.exclude ?? [];
  return decks.filter((deck) => {
    const haystack = [deck.sourceUrl, deck.eventName, deck.reportedArchetype, deck.player].filter(Boolean).join("\n");
    return (include.length === 0 || include.some((pattern) => haystack.includes(pattern))) && !exclude.some((pattern) => haystack.includes(pattern));
  });
}

function filterDecksForHistoricalDateRange(
  database: Parameters<typeof upsertRawDeck>[0],
  decks: readonly RawDeck[],
  options: {
    readonly policy?: Partial<CollectionDatePolicy>;
    readonly startDate?: string;
    readonly endDate?: string;
  }
): { readonly included: readonly RawDeck[]; readonly excluded: number } {
  const range = parseHistoricalDateRange(options);
  const policy = mergeCollectionDatePolicy(options.policy);
  const included: RawDeck[] = [];
  let excluded = 0;

  for (const deck of decks) {
    if (!deck.eventDate) {
      handleRejectedDeck(database, deck, "missing_event_date", policy.missingDateHandling, range);
      excluded += 1;
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deck.eventDate)) {
      handleRejectedDeck(database, deck, "invalid_event_date", policy.invalidDateHandling, range);
      excluded += 1;
      continue;
    }
    if (!isDateInHistoricalRange(deck.eventDate, range)) {
      handleRejectedDeck(database, deck, "out_of_range", policy.outOfRangeHandling, range);
      excluded += 1;
      continue;
    }
    included.push(deck);
  }

  return { excluded, included };
}

function mergeCollectionDatePolicy(policy: Partial<CollectionDatePolicy> | undefined): CollectionDatePolicy {
  return {
    invalidDateHandling: policy?.invalidDateHandling ?? "quarantine",
    missingDateHandling: policy?.missingDateHandling ?? "quarantine",
    outOfRangeHandling: policy?.outOfRangeHandling ?? "quarantine"
  };
}

function handleRejectedDeck(
  database: Parameters<typeof upsertRawDeck>[0],
  deck: RawDeck,
  reason: "missing_event_date" | "invalid_event_date" | "out_of_range",
  handling: CollectionDateHandling,
  range: ReturnType<typeof parseHistoricalDateRange>
): void {
  if (handling === "discard") {
    return;
  }

  insertCollectionDateReview(database, {
    eventDate: deck.eventDate,
    metadata: { handling, range },
    reason,
    source: deck.source,
    sourceUrl: deck.sourceUrl
  });

  if (handling === "persist_inactive") {
    upsertRawDeck(database, deck, {
      active: false,
      collectionStatus: reason
    });
  }
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
