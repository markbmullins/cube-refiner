import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  createPipelineRunId,
  listPeriodMatrixInputRows,
  listPersistedArchetypePeriodSummaryRows,
  listPersistedCardPeriodMatrixRows,
  replacePeriodMatrixRows,
  upsertPipelineRun
} from "../db/index.js";
import type { PeriodMatrixInputRow } from "../db/repository.js";
import type { ArchetypePeriodSummaryRow, CardPeriodMatrixRow } from "../types/contracts.js";

export type BuildPeriodMatrixOptions = {
  readonly cardPeriodMatrixCsvPath?: string;
  readonly archetypePeriodCoverageCsvPath?: string;
  readonly configHash?: string;
  readonly pipelineRunId?: string;
};

export type BuildPeriodMatrixSummary = {
  readonly archetypePeriodCoverageCsvPath?: string;
  readonly archetypeRows: number;
  readonly cardPeriodMatrixCsvPath?: string;
  readonly cardRows: number;
  readonly pipelineRunId: string;
};

type PeriodInfo = Pick<
  PeriodMatrixInputRow,
  "periodId" | "setCode" | "setName" | "periodStartDate" | "periodEndDate" | "sortOrder"
>;

export function buildPeriodMatrices(
  database: DatabaseSync,
  options: BuildPeriodMatrixOptions = {}
): BuildPeriodMatrixSummary {
  const pipelineRunId = options.pipelineRunId ?? createPipelineRunId();
  const configHash = options.configHash ?? stableConfigHash({ stage: "period-matrices" });
  upsertPipelineRun(database, {
    configHash,
    id: pipelineRunId,
    status: "running"
  });

  try {
    const inputRows = listPeriodMatrixInputRows(database);
    const calculated = calculatePeriodMatrices(inputRows, pipelineRunId);
    replacePeriodMatrixRows(database, pipelineRunId, calculated.cardRows, calculated.archetypeRows);
    const cardRows = listPersistedCardPeriodMatrixRows(database, pipelineRunId);
    const archetypeRows = listPersistedArchetypePeriodSummaryRows(database, pipelineRunId);

    if (options.cardPeriodMatrixCsvPath) {
      writeCardPeriodMatrixCsv(options.cardPeriodMatrixCsvPath, cardRows);
    }
    if (options.archetypePeriodCoverageCsvPath) {
      writeArchetypePeriodCoverageCsv(options.archetypePeriodCoverageCsvPath, archetypeRows);
    }

    upsertPipelineRun(database, {
      completedAt: new Date().toISOString(),
      configHash,
      id: pipelineRunId,
      status: "completed"
    });

    return {
      archetypePeriodCoverageCsvPath: options.archetypePeriodCoverageCsvPath,
      archetypeRows: archetypeRows.length,
      cardPeriodMatrixCsvPath: options.cardPeriodMatrixCsvPath,
      cardRows: cardRows.length,
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

export function calculatePeriodMatrices(
  inputRows: readonly PeriodMatrixInputRow[],
  pipelineRunId: string
): {
  readonly cardRows: readonly CardPeriodMatrixRow[];
  readonly archetypeRows: readonly ArchetypePeriodSummaryRow[];
} {
  const periodInfoById = new Map<string, PeriodInfo>();
  const deckWeightsByPeriod = new Map<string, Map<string, number>>();
  const cardDeckWeights = new Map<string, Map<string, number>>();
  const cardCopyCounts = new Map<string, { mainboardCopies: number; sideboardCopies: number }>();
  const cardArchetypes = new Map<string, Set<string>>();
  const archetypeDeckWeights = new Map<string, Map<string, number>>();
  const archetypeCards = new Map<string, Map<string, number>>();

  for (const row of inputRows) {
    if (row.weight <= 0) {
      continue;
    }

    periodInfoById.set(row.periodId, row);

    const periodDeckWeights = deckWeightsByPeriod.get(row.periodId) ?? new Map<string, number>();
    periodDeckWeights.set(row.deckId, row.weight);
    deckWeightsByPeriod.set(row.periodId, periodDeckWeights);

    const cardKey = periodCardKey(row.periodId, row.cardName);
    const deckWeightsForCard = cardDeckWeights.get(cardKey) ?? new Map<string, number>();
    deckWeightsForCard.set(row.deckId, row.weight);
    cardDeckWeights.set(cardKey, deckWeightsForCard);

    const copyCounts = cardCopyCounts.get(cardKey) ?? { mainboardCopies: 0, sideboardCopies: 0 };
    if (row.zone === "mainboard") {
      copyCounts.mainboardCopies += row.copies * row.weight;
    } else {
      copyCounts.sideboardCopies += row.copies * row.weight;
    }
    cardCopyCounts.set(cardKey, copyCounts);

    const archetypes = cardArchetypes.get(cardKey) ?? new Set<string>();
    archetypes.add(row.archetypeFamily);
    cardArchetypes.set(cardKey, archetypes);

    const archetypeKey = periodArchetypeKey(row.periodId, row.archetypeFamily);
    const deckWeightsForArchetype = archetypeDeckWeights.get(archetypeKey) ?? new Map<string, number>();
    deckWeightsForArchetype.set(row.deckId, row.weight);
    archetypeDeckWeights.set(archetypeKey, deckWeightsForArchetype);

    const cardWeights = archetypeCards.get(archetypeKey) ?? new Map<string, number>();
    cardWeights.set(row.cardName, (cardWeights.get(row.cardName) ?? 0) + row.copies * row.weight);
    archetypeCards.set(archetypeKey, cardWeights);
  }

  const cardRows: CardPeriodMatrixRow[] = [];
  for (const [key, deckWeightsForCard] of cardDeckWeights) {
    const [periodId = "", cardName = ""] = key.split("\0");
    const periodInfo = periodInfoById.get(periodId);
    if (!periodInfo) {
      continue;
    }
    const totalDecksInPeriod = sumValues(deckWeightsByPeriod.get(periodId) ?? new Map());
    const decksWithCard = sumValues(deckWeightsForCard);
    const copyCounts = cardCopyCounts.get(key) ?? { mainboardCopies: 0, sideboardCopies: 0 };
    cardRows.push({
      archetypeFamilies: [...(cardArchetypes.get(key) ?? new Set())].sort((left, right) => left.localeCompare(right)),
      cardName,
      decksWithCard,
      mainboardCopies: copyCounts.mainboardCopies,
      metagameShare: totalDecksInPeriod === 0 ? 0 : decksWithCard / totalDecksInPeriod,
      periodEndDate: periodInfo.periodEndDate,
      periodId,
      periodStartDate: periodInfo.periodStartDate,
      pipelineRunId,
      setCode: periodInfo.setCode,
      setName: periodInfo.setName,
      sideboardCopies: copyCounts.sideboardCopies,
      sortOrder: periodInfo.sortOrder,
      totalDecksInPeriod
    });
  }

  const archetypeRows: ArchetypePeriodSummaryRow[] = [];
  for (const [key, deckWeightsForArchetype] of archetypeDeckWeights) {
    const [periodId = "", archetypeFamily = ""] = key.split("\0");
    const periodInfo = periodInfoById.get(periodId);
    if (!periodInfo) {
      continue;
    }
    const totalDecksInPeriod = sumValues(deckWeightsByPeriod.get(periodId) ?? new Map());
    const totalDeckWeight = sumValues(deckWeightsForArchetype);
    const cardWeights = archetypeCards.get(key) ?? new Map<string, number>();
    archetypeRows.push({
      archetypeFamily,
      periodEndDate: periodInfo.periodEndDate,
      periodId,
      periodMetagameShare: totalDecksInPeriod === 0 ? 0 : totalDeckWeight / totalDecksInPeriod,
      periodStartDate: periodInfo.periodStartDate,
      pipelineRunId,
      representativeCards: representativeCards(cardWeights),
      setCode: periodInfo.setCode,
      setName: periodInfo.setName,
      sortOrder: periodInfo.sortOrder,
      totalDeckWeight,
      uniqueCards: cardWeights.size
    });
  }

  return {
    archetypeRows: archetypeRows.sort((left, right) => left.sortOrder - right.sortOrder || left.archetypeFamily.localeCompare(right.archetypeFamily)),
    cardRows: cardRows.sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.archetypeFamilies.join("|").localeCompare(right.archetypeFamilies.join("|")) ||
        left.cardName.localeCompare(right.cardName)
    )
  };
}

function representativeCards(cardWeights: ReadonlyMap<string, number>): readonly string[] {
  return [...cardWeights.entries()]
    .sort(([leftCard, leftWeight], [rightCard, rightWeight]) => rightWeight - leftWeight || leftCard.localeCompare(rightCard))
    .slice(0, 5)
    .map(([cardName]) => cardName);
}

function writeCardPeriodMatrixCsv(filePath: string, rows: readonly CardPeriodMatrixRow[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "card_name,period_id,set_code,set_name,period_start_date,period_end_date,decks_with_card,total_decks_in_period,metagame_share,mainboard_copies,sideboard_copies,archetype_families",
      ...rows.map((row) =>
        [
          row.cardName,
          row.periodId,
          row.setCode,
          row.setName,
          row.periodStartDate,
          row.periodEndDate,
          formatNumber(row.decksWithCard),
          formatNumber(row.totalDecksInPeriod),
          formatNumber(row.metagameShare),
          formatNumber(row.mainboardCopies),
          formatNumber(row.sideboardCopies),
          row.archetypeFamilies.join("|")
        ].map(csvEscape).join(",")
      )
    ].join("\n") + "\n"
  );
}

function writeArchetypePeriodCoverageCsv(filePath: string, rows: readonly ArchetypePeriodSummaryRow[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "archetype_family,period_id,set_code,set_name,period_start_date,period_end_date,total_deck_weight,unique_cards,representative_cards,period_metagame_share",
      ...rows.map((row) =>
        [
          row.archetypeFamily,
          row.periodId,
          row.setCode,
          row.setName,
          row.periodStartDate,
          row.periodEndDate,
          formatNumber(row.totalDeckWeight),
          String(row.uniqueCards),
          row.representativeCards.join("|"),
          formatNumber(row.periodMetagameShare)
        ].map(csvEscape).join(",")
      )
    ].join("\n") + "\n"
  );
}

function periodCardKey(periodId: string, cardName: string): string {
  return `${periodId}\0${cardName}`;
}

function periodArchetypeKey(periodId: string, archetypeFamily: string): string {
  return `${periodId}\0${archetypeFamily}`;
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
