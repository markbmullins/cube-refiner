import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  listNormalizedDecksForDedupe,
  updateNormalizedDeckFingerprint,
  upsertDeckWeight,
  upsertDedupeCluster
} from "../db/index.js";
import type { DeckCard } from "../types/contracts.js";

export type DedupeOptions = {
  readonly nearOverlapThreshold?: number;
  readonly reportCsvPath?: string;
};

export type DedupeReportRow = {
  readonly strategy: "exact" | "near" | "unique";
  readonly clusterId?: string;
  readonly deckId: string;
  readonly weight: number;
  readonly explanation: string;
};

export type DedupeSummary = {
  readonly exactClusters: number;
  readonly nearClusters: number;
  readonly reportCsvPath?: string;
  readonly weightedDecks: number;
};

type DeckForDedupe = {
  readonly deckId: string;
  readonly eventDate: string;
  readonly eventMonth: string;
  readonly archetypeFamily: string;
  readonly fingerprint: string;
  readonly mainboard: readonly DeckCard[];
};

type DeckWeightState = {
  exactClusterId?: string;
  nearClusterId?: string;
  weight: number;
  explanation: string;
};

export function dedupeDecks(database: DatabaseSync, options: DedupeOptions = {}): DedupeSummary {
  const nearOverlapThreshold = options.nearOverlapThreshold ?? 55;
  const decks = listNormalizedDecksForDedupe(database).map((deck) => ({
    ...deck,
    eventMonth: deck.eventDate.slice(0, 7),
    fingerprint: deckFingerprint(deck.mainboard)
  }));
  const weights = new Map<string, DeckWeightState>(
    decks.map((deck) => [
      deck.deckId,
      {
        explanation: "Unique decklist",
        weight: 1
      }
    ])
  );
  const reportRows: DedupeReportRow[] = [];

  for (const deck of decks) {
    updateNormalizedDeckFingerprint(database, deck.deckId, deck.fingerprint);
  }

  const exactGroups = groupBy(decks, (deck) => deck.fingerprint).filter((group) => group.length > 1);
  for (const group of exactGroups) {
    const sortedGroup = [...group].sort(compareDeckIds);
    const clusterId = stableId("exact-dedupe", sortedGroup[0]?.fingerprint ?? "", ...sortedGroup.map((deck) => deck.deckId));
    const explanation = `Exact duplicate group of ${sortedGroup.length} decks; ${sortedGroup[0]?.deckId} kept as representative.`;
    upsertDedupeCluster(database, {
      clusterId,
      explanation,
      strategy: "exact"
    });

    sortedGroup.forEach((deck, index) => {
      const weight = index === 0 ? 1 : 0;
      weights.set(deck.deckId, {
        exactClusterId: clusterId,
        explanation,
        weight
      });
      reportRows.push({
        clusterId,
        deckId: deck.deckId,
        explanation,
        strategy: "exact",
        weight
      });
    });
  }

  const exactDuplicateDeckIds = new Set(
    [...weights.entries()].filter(([, state]) => state.exactClusterId && state.weight === 0).map(([deckId]) => deckId)
  );
  const nearGroups = buildNearDuplicateGroups(
    decks.filter((deck) => !exactDuplicateDeckIds.has(deck.deckId)),
    nearOverlapThreshold
  );

  for (const group of nearGroups) {
    const sortedGroup = [...group].sort(compareDeckIds);
    const eventMonth = sortedGroup[0]?.eventMonth;
    const archetypeFamily = sortedGroup[0]?.archetypeFamily;
    const clusterId = stableId("near-dedupe", archetypeFamily ?? "", eventMonth ?? "", ...sortedGroup.map((deck) => deck.deckId));
    const weight = 1 / sortedGroup.length;
    const explanation = `Near-duplicate ${archetypeFamily} cluster in ${eventMonth}; ${sortedGroup.length} decks weighted to ${weight.toFixed(4)} each.`;
    upsertDedupeCluster(database, {
      archetypeFamily,
      clusterId,
      eventMonth,
      explanation,
      strategy: "near"
    });

    for (const deck of sortedGroup) {
      const previous = weights.get(deck.deckId);
      weights.set(deck.deckId, {
        exactClusterId: previous?.exactClusterId,
        explanation,
        nearClusterId: clusterId,
        weight: Math.min(previous?.weight ?? 1, weight)
      });
      reportRows.push({
        clusterId,
        deckId: deck.deckId,
        explanation,
        strategy: "near",
        weight
      });
    }
  }

  for (const deck of decks) {
    const state = weights.get(deck.deckId) ?? { explanation: "Unique decklist", weight: 1 };
    upsertDeckWeight(database, {
      deckId: deck.deckId,
      exactDuplicateClusterId: state.exactClusterId,
      explanation: state.explanation,
      nearDuplicateClusterId: state.nearClusterId,
      weight: state.weight
    });
    if (!state.exactClusterId && !state.nearClusterId) {
      reportRows.push({
        deckId: deck.deckId,
        explanation: state.explanation,
        strategy: "unique",
        weight: state.weight
      });
    }
  }

  const sortedRows = reportRows
    .map((row) => ({
      ...row,
      weight: weights.get(row.deckId)?.weight ?? row.weight
    }))
    .sort((a, b) => a.strategy.localeCompare(b.strategy) || a.deckId.localeCompare(b.deckId));
  if (options.reportCsvPath) {
    writeReportCsv(options.reportCsvPath, sortedRows);
  }

  return {
    exactClusters: exactGroups.length,
    nearClusters: nearGroups.length,
    reportCsvPath: options.reportCsvPath,
    weightedDecks: decks.length
  };
}

export function deckFingerprint(mainboard: readonly DeckCard[]): string {
  return createHash("sha256")
    .update(
      [...mainboard]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((card) => `${card.copies} ${card.name}`)
        .join("\n")
    )
    .digest("hex");
}

export function mainboardOverlap(left: readonly DeckCard[], right: readonly DeckCard[]): number {
  const rightCounts = new Map(right.map((card) => [card.name, card.copies]));
  let overlap = 0;

  for (const card of left) {
    overlap += Math.min(card.copies, rightCounts.get(card.name) ?? 0);
  }

  return overlap;
}

function buildNearDuplicateGroups(
  decks: readonly DeckForDedupe[],
  nearOverlapThreshold: number
): readonly (readonly DeckForDedupe[])[] {
  const groups = groupBy(decks, (deck) => `${deck.archetypeFamily}\0${deck.eventMonth}`);
  const nearGroups: DeckForDedupe[][] = [];

  for (const group of groups) {
    const components = connectedComponents(group, (left, right) => mainboardOverlap(left.mainboard, right.mainboard) >= nearOverlapThreshold);
    nearGroups.push(...components.filter((component) => component.length > 1));
  }

  return nearGroups;
}

function connectedComponents<T>(items: readonly T[], isConnected: (left: T, right: T) => boolean): readonly T[][] {
  const visited = new Set<number>();
  const components: T[][] = [];

  for (let index = 0; index < items.length; index += 1) {
    if (visited.has(index)) {
      continue;
    }

    const component: T[] = [];
    const queue = [index];
    visited.add(index);

    while (queue.length > 0) {
      const currentIndex = queue.shift() ?? 0;
      const current = items[currentIndex];
      if (!current) {
        continue;
      }

      component.push(current);
      for (let candidateIndex = 0; candidateIndex < items.length; candidateIndex += 1) {
        if (visited.has(candidateIndex) || candidateIndex === currentIndex) {
          continue;
        }

        const candidate = items[candidateIndex];
        if (candidate && isConnected(current, candidate)) {
          visited.add(candidateIndex);
          queue.push(candidateIndex);
        }
      }
    }

    components.push(component);
  }

  return components;
}

function groupBy<T>(items: readonly T[], keyForItem: (item: T) => string): readonly (readonly T[])[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyForItem(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return [...groups.values()];
}

function writeReportCsv(filePath: string, rows: readonly DedupeReportRow[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "strategy,cluster_id,deck_id,weight,explanation",
      ...rows.map((row) =>
        [
          row.strategy,
          row.clusterId ?? "",
          row.deckId,
          String(row.weight),
          row.explanation
        ].map(csvEscape).join(",")
      )
    ].join("\n") + "\n"
  );
}

function csvEscape(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, "\"\"")}"`;
}

function compareDeckIds(left: DeckForDedupe, right: DeckForDedupe): number {
  return left.deckId.localeCompare(right.deckId);
}

function stableId(scope: string, ...parts: readonly string[]): string {
  return createHash("sha256").update([scope, ...parts].join("\0")).digest("hex");
}
