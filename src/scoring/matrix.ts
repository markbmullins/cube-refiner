import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  createPipelineRunId,
  listMatrixInputRows,
  listPersistedMatrixRows,
  replaceCardArchetypeMatrixRows,
  upsertPipelineRun
} from "../db/index.js";
import type { CardArchetypeMatrixInput, MatrixInputRow } from "../db/repository.js";

export type ArchetypeSummaryRow = {
  readonly archetypeFamily: string;
  readonly totalDeckWeight: number;
  readonly uniqueCards: number;
  readonly mainboardCopies: number;
  readonly sideboardCopies: number;
};

export type BuildMatrixOptions = {
  readonly archetypeSummaryCsvPath?: string;
  readonly configHash?: string;
  readonly matrixCsvPath?: string;
  readonly pipelineRunId?: string;
};

export type BuildMatrixSummary = {
  readonly archetypeSummaryCsvPath?: string;
  readonly archetypeSummaryRows: number;
  readonly matrixCsvPath?: string;
  readonly matrixRows: number;
  readonly pipelineRunId: string;
};

export function buildCardArchetypeMatrix(
  database: DatabaseSync,
  options: BuildMatrixOptions = {}
): BuildMatrixSummary {
  const pipelineRunId = options.pipelineRunId ?? createPipelineRunId();
  const configHash = options.configHash ?? stableConfigHash({ stage: "card-archetype-matrix" });
  upsertPipelineRun(database, {
    configHash,
    id: pipelineRunId,
    status: "running"
  });

  try {
    const inputRows = listMatrixInputRows(database);
    const matrixRows = calculateCardArchetypeMatrix(inputRows).map((row) => ({
      ...row,
      pipelineRunId
    }));
    replaceCardArchetypeMatrixRows(database, pipelineRunId, matrixRows);
    const persistedRows = listPersistedMatrixRows(database, pipelineRunId);
    const summaryRows = calculateArchetypeSummaries(persistedRows);

    if (options.matrixCsvPath) {
      writeMatrixCsv(options.matrixCsvPath, persistedRows);
    }

    if (options.archetypeSummaryCsvPath) {
      writeArchetypeSummaryCsv(options.archetypeSummaryCsvPath, summaryRows);
    }

    upsertPipelineRun(database, {
      completedAt: new Date().toISOString(),
      configHash,
      id: pipelineRunId,
      status: "completed"
    });

    return {
      archetypeSummaryCsvPath: options.archetypeSummaryCsvPath,
      archetypeSummaryRows: summaryRows.length,
      matrixCsvPath: options.matrixCsvPath,
      matrixRows: persistedRows.length,
      pipelineRunId
    };
  } catch (error) {
    upsertPipelineRun(database, {
      completedAt: new Date().toISOString(),
      configHash,
      id: pipelineRunId,
      status: "failed"
    });
    throw error;
  }
}

export function calculateCardArchetypeMatrix(
  inputRows: readonly MatrixInputRow[]
): readonly Omit<CardArchetypeMatrixInput, "pipelineRunId">[] {
  const deckWeightsByFamily = new Map<string, Map<string, number>>();
  const cardDeckWeightsByFamily = new Map<string, Map<string, Map<string, number>>>();
  const copyCountsByFamilyCard = new Map<string, { mainboardCopies: number; sideboardCopies: number }>();

  for (const row of inputRows) {
    if (row.weight <= 0) {
      continue;
    }

    const deckWeights = deckWeightsByFamily.get(row.archetypeFamily) ?? new Map<string, number>();
    deckWeights.set(row.deckId, row.weight);
    deckWeightsByFamily.set(row.archetypeFamily, deckWeights);

    const cardDeckWeights = cardDeckWeightsByFamily.get(row.archetypeFamily) ?? new Map<string, Map<string, number>>();
    const deckWeightsForCard = cardDeckWeights.get(row.cardName) ?? new Map<string, number>();
    deckWeightsForCard.set(row.deckId, row.weight);
    cardDeckWeights.set(row.cardName, deckWeightsForCard);
    cardDeckWeightsByFamily.set(row.archetypeFamily, cardDeckWeights);

    const key = matrixKey(row.archetypeFamily, row.cardName);
    const copyCounts = copyCountsByFamilyCard.get(key) ?? { mainboardCopies: 0, sideboardCopies: 0 };
    if (row.zone === "mainboard") {
      copyCounts.mainboardCopies += row.copies * row.weight;
    } else {
      copyCounts.sideboardCopies += row.copies * row.weight;
    }
    copyCountsByFamilyCard.set(key, copyCounts);
  }

  const matrixRows: Omit<CardArchetypeMatrixInput, "pipelineRunId">[] = [];
  for (const [archetypeFamily, cardDeckWeights] of [...cardDeckWeightsByFamily.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const totalDecksInArchetype = sumValues(deckWeightsByFamily.get(archetypeFamily) ?? new Map());
    for (const [cardName, deckWeightsForCard] of [...cardDeckWeights.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      const decksWithCard = sumValues(deckWeightsForCard);
      const copyCounts = copyCountsByFamilyCard.get(matrixKey(archetypeFamily, cardName)) ?? {
        mainboardCopies: 0,
        sideboardCopies: 0
      };
      matrixRows.push({
        affinity: totalDecksInArchetype === 0 ? 0 : decksWithCard / totalDecksInArchetype,
        archetypeFamily,
        cardName,
        decksWithCard,
        mainboardCopies: copyCounts.mainboardCopies,
        sideboardCopies: copyCounts.sideboardCopies,
        totalDecksInArchetype
      });
    }
  }

  return matrixRows;
}

export function calculateArchetypeSummaries(
  matrixRows: readonly Pick<
    CardArchetypeMatrixInput,
    "archetypeFamily" | "totalDecksInArchetype" | "mainboardCopies" | "sideboardCopies"
  >[]
): readonly ArchetypeSummaryRow[] {
  const rowsByFamily = new Map<string, ArchetypeSummaryRow>();

  for (const row of matrixRows) {
    const current = rowsByFamily.get(row.archetypeFamily) ?? {
      archetypeFamily: row.archetypeFamily,
      mainboardCopies: 0,
      sideboardCopies: 0,
      totalDeckWeight: row.totalDecksInArchetype,
      uniqueCards: 0
    };
    rowsByFamily.set(row.archetypeFamily, {
      archetypeFamily: row.archetypeFamily,
      mainboardCopies: current.mainboardCopies + row.mainboardCopies,
      sideboardCopies: current.sideboardCopies + row.sideboardCopies,
      totalDeckWeight: row.totalDecksInArchetype,
      uniqueCards: current.uniqueCards + 1
    });
  }

  return [...rowsByFamily.values()].sort((a, b) => a.archetypeFamily.localeCompare(b.archetypeFamily));
}

function writeMatrixCsv(filePath: string, rows: readonly CardArchetypeMatrixInput[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "card_name,archetype_family,decks_with_card,total_decks_in_archetype,mainboard_copies,sideboard_copies,affinity",
      ...rows.map((row) =>
        [
          row.cardName,
          row.archetypeFamily,
          formatNumber(row.decksWithCard),
          formatNumber(row.totalDecksInArchetype),
          formatNumber(row.mainboardCopies),
          formatNumber(row.sideboardCopies),
          formatNumber(row.affinity)
        ].map(csvEscape).join(",")
      )
    ].join("\n") + "\n"
  );
}

function writeArchetypeSummaryCsv(filePath: string, rows: readonly ArchetypeSummaryRow[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "archetype_family,total_deck_weight,unique_cards,mainboard_copies,sideboard_copies",
      ...rows.map((row) =>
        [
          row.archetypeFamily,
          formatNumber(row.totalDeckWeight),
          String(row.uniqueCards),
          formatNumber(row.mainboardCopies),
          formatNumber(row.sideboardCopies)
        ].map(csvEscape).join(",")
      )
    ].join("\n") + "\n"
  );
}

function matrixKey(archetypeFamily: string, cardName: string): string {
  return `${archetypeFamily}\0${cardName}`;
}

function sumValues(values: ReadonlyMap<string, number>): number {
  return [...values.values()].reduce((total, value) => total + value, 0);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/g, "").replace(/\.$/, "");
}

function csvEscape(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, "\"\"")}"`;
}

function stableConfigHash(config: unknown): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}
