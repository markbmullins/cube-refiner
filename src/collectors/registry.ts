import type { DeckSource } from "../types/contracts.js";
import { mtgGoldfishCollector } from "./mtggoldfish.js";
import { mtgoCollector } from "./mtgo.js";
import type { DeckCollector } from "./types.js";
import { mtgTop8Collector } from "./mtgtop8.js";

const registeredCollectors: readonly DeckCollector[] = [
  mtgTop8Collector,
  mtgoCollector,
  mtgGoldfishCollector
];

export function getCollector(source: DeckSource): DeckCollector {
  const collector = registeredCollectors.find((candidate) => candidate.source === source);
  if (!collector) {
    throw new Error(`No collector registered for source: ${source}`);
  }

  return collector;
}

export function getCollectors(sources: readonly DeckSource[] = allCollectorSources): readonly DeckCollector[] {
  return sources.map(getCollector);
}

export const allCollectorSources: readonly DeckSource[] = ["mtgtop8", "mtgo", "mtggoldfish"];
