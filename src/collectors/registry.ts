import type { DeckSource } from "../types/contracts.js";
import { mtgoCollector } from "./mtgo.js";
import type { CollectorContext, DeckCollector } from "./types.js";
import { mtgTop8Collector } from "./mtgtop8.js";

const plannedCollectors: readonly DeckCollector[] = [
  mtgTop8Collector,
  mtgoCollector,
  createPlannedCollector("mtggoldfish")
];

export function getCollector(source: DeckSource): DeckCollector {
  const collector = plannedCollectors.find((candidate) => candidate.source === source);
  if (!collector) {
    throw new Error(`No collector registered for source: ${source}`);
  }

  return collector;
}

export function getCollectors(sources: readonly DeckSource[] = allCollectorSources): readonly DeckCollector[] {
  return sources.map(getCollector);
}

export const allCollectorSources: readonly DeckSource[] = ["mtgtop8", "mtgo", "mtggoldfish"];

function createPlannedCollector(source: DeckSource): DeckCollector {
  return {
    async collect(context: CollectorContext) {
      context.logger.warn(
        `${source} collector parsing is planned in a follow-up issue; framework run will persist an empty parsed snapshot.`
      );
      return [];
    },
    source
  };
}
