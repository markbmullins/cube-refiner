import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  listCubeRunCards,
  listArchetypeReconstructionTargets,
  listHistoricalCardScoreRows,
  listPersistedCandidatePoolCards,
  listPersistedCards,
  replaceCubeRunCards,
  upsertCubeRun
} from "../db/index.js";
import type { CandidatePoolCardInput, CubeRunCardInput, PersistedCardRecord } from "../db/repository.js";
import type { CandidatePool, CubeCardRole, HistoricalCardRole, HistoricalCardScoreRow, ArchetypeReconstructionTargetRow } from "../types/contracts.js";

export type CubeSection = "White" | "Blue" | "Black" | "Red" | "Green" | "Gold" | "Colorless" | "Lands";

export type CubeGeneratorConfig = {
  readonly mode: "aggregate" | "historical";
  readonly targets: Readonly<Record<CubeSection, number>>;
  readonly totalCards: number;
  readonly minimumRemoval: number;
  readonly minimumCounterspells: number;
  readonly minimumSweepers: number;
  readonly minimumFormatPillars: number;
  readonly minimumArchetypeIcons: number;
  readonly minimumRepresentedPeriods: number;
  readonly counterspellNamePatterns: readonly string[];
  readonly sweeperNamePatterns: readonly string[];
};

export type GenerateCubeOptions = Partial<CubeGeneratorConfig> & {
  readonly configHash?: string;
  readonly cubeRunId?: string;
  readonly outputCsvPath?: string;
  readonly pipelineRunId: string;
};

export type GenerateCubeSummary = {
  readonly cubeRunId: string;
  readonly outputCsvPath?: string;
  readonly selectedCards: number;
};

type CubeCandidateCard = {
  readonly cardName: string;
  readonly card?: PersistedCardRecord;
  readonly pools: readonly CandidatePool[];
  readonly roles: readonly CubeCardRole[];
  readonly score: number;
  readonly historicalRole?: HistoricalCardRole;
  readonly historicalScore?: number;
  readonly reconstructionPeriods: readonly string[];
  readonly reconstructionRoles: readonly string[];
  readonly explanation: string;
  readonly section: CubeSection;
};

const defaultTargets: Readonly<Record<CubeSection, number>> = {
  Black: 45,
  Blue: 45,
  Colorless: 35,
  Gold: 45,
  Green: 45,
  Lands: 55,
  Red: 45,
  White: 45
};

const defaultConfig: CubeGeneratorConfig = {
  counterspellNamePatterns: ["counterspell", "mana leak", "remand", "cryptic command", "spell pierce", "dispel"],
  minimumArchetypeIcons: 24,
  minimumCounterspells: 12,
  minimumFormatPillars: 24,
  minimumRepresentedPeriods: 12,
  minimumRemoval: 35,
  minimumSweepers: 6,
  mode: "aggregate",
  sweeperNamePatterns: ["wrath", "damnation", "supreme verdict", "anger of the gods", "engineered explosives"],
  targets: defaultTargets,
  totalCards: 360
};

export function generateCube(database: DatabaseSync, options: GenerateCubeOptions): GenerateCubeSummary {
  const config = mergeConfig(options);
  const cubeRunId = options.cubeRunId ?? randomUUID();
  const candidates = buildCubeCandidates(
    listPersistedCandidatePoolCards(database, options.pipelineRunId),
    listPersistedCards(database),
    config.mode === "historical" ? listHistoricalCardScoreRows(database, options.pipelineRunId) : [],
    config.mode === "historical" ? listArchetypeReconstructionTargets(database, options.pipelineRunId) : []
  );
  const selectedCards = config.mode === "historical" ? selectHistoricalCubeCards(candidates, config) : selectCubeCards(candidates, config);
  const selected = selectedCards.map((card, index) => ({
    cardName: card.cardName,
    cubeRunId,
    position: index,
    reason: card.explanation,
    roles: card.roles
  }));

  upsertCubeRun(database, {
    config,
    configHash: options.configHash,
    id: cubeRunId,
    pipelineRunId: options.pipelineRunId,
    totalCards: selected.length
  });
  replaceCubeRunCards(database, cubeRunId, selected);

  if (options.outputCsvPath) {
    writeCubeCsv(options.outputCsvPath, listCubeRunCards(database, cubeRunId));
  }

  return {
    cubeRunId,
    outputCsvPath: options.outputCsvPath,
    selectedCards: selected.length
  };
}

export function selectCubeCards(
  candidates: readonly CubeCandidateCard[],
  config: CubeGeneratorConfig = defaultConfig
): readonly CubeCandidateCard[] {
  const selected = new Map<string, CubeCandidateCard>();
  const counts = initialSectionCounts();

  const addFrom = (pool: CandidatePool | undefined, reason: string, predicate: (candidate: CubeCandidateCard) => boolean = () => true) => {
    for (const candidate of sortedCandidates(candidates).filter((card) => (!pool || card.pools.includes(pool)) && predicate(card))) {
      if (selected.size >= config.totalCards) {
        return;
      }
      addCandidate(selected, counts, candidate, config, reason);
    }
  };

  addFrom("lands", "fixing");
  addFrom("glue_cards", "glue");
  addFrom("signpost_cards", "signpost");
  addFrom(undefined, "support", (candidate) => candidate.roles.includes("support"));
  addFrom(undefined, "curve", (candidate) => candidate.roles.includes("curve"));
  addMinimum(config.minimumRemoval, "removal minimum", selected, counts, candidates, config, (candidate) => candidate.pools.includes("removal"));
  addMinimum(config.minimumSweepers, "sweeper minimum", selected, counts, candidates, config, (candidate) => matchesName(candidate, config.sweeperNamePatterns));
  addMinimum(config.minimumCounterspells, "counterspell minimum", selected, counts, candidates, config, (candidate) => matchesName(candidate, config.counterspellNamePatterns));
  addFrom("removal", "role filler");
  addFrom("threats", "role filler");
  addFrom("auto_includes", "high score");
  addFrom(undefined, "best remaining");

  return [...selected.values()];
}

export function selectHistoricalCubeCards(
  candidates: readonly CubeCandidateCard[],
  config: CubeGeneratorConfig = defaultConfig
): readonly CubeCandidateCard[] {
  const selected = new Map<string, CubeCandidateCard>();
  const counts = initialSectionCounts();

  const addHistoricalMinimum = (
    minimum: number,
    reason: string,
    predicate: (candidate: CubeCandidateCard) => boolean
  ) => {
    let current = [...selected.values()].filter(predicate).length;
    for (const candidate of sortedHistoricalCandidates(candidates).filter(predicate)) {
      if (selected.size >= config.totalCards || current >= minimum) {
        return;
      }
      const sizeBefore = selected.size;
      addCandidate(selected, counts, candidate, config, reason);
      if (selected.size > sizeBefore) {
        current += 1;
      }
    }
  };

  addHistoricalMinimum(config.minimumFormatPillars, "historical pillar", (candidate) => candidate.historicalRole === "format_pillar");
  addHistoricalMinimum(config.minimumArchetypeIcons, "historical archetype icon", (candidate) => candidate.historicalRole === "archetype_icon");

  const representedPeriods = new Set<string>([...selected.values()].flatMap((candidate) => candidate.reconstructionPeriods));
  for (const candidate of sortedHistoricalCandidates(candidates).filter((entry) => entry.reconstructionPeriods.length > 0)) {
    if (selected.size >= config.totalCards || representedPeriods.size >= config.minimumRepresentedPeriods) {
      break;
    }
    if (candidate.reconstructionPeriods.some((periodId) => !representedPeriods.has(periodId))) {
      addCandidate(selected, counts, candidate, config, "set-release coverage");
      for (const periodId of candidate.reconstructionPeriods) {
        representedPeriods.add(periodId);
      }
    }
  }

  for (const candidate of sortedHistoricalCandidates(candidates).filter((entry) => entry.reconstructionRoles.includes("glue"))) {
    if (selected.size >= config.totalCards) {
      break;
    }
    addCandidate(selected, counts, candidate, config, "shared ecosystem glue");
  }

  for (const candidate of selectCubeCards(candidates, config)) {
    if (selected.size >= config.totalCards) {
      break;
    }
    addCandidate(selected, counts, candidate, config, "historical fallback");
  }

  return [...selected.values()];
}

function addMinimum(
  minimum: number,
  reason: string,
  selected: Map<string, CubeCandidateCard>,
  counts: Map<CubeSection, number>,
  candidates: readonly CubeCandidateCard[],
  config: CubeGeneratorConfig,
  predicate: (candidate: CubeCandidateCard) => boolean
): void {
  let current = [...selected.values()].filter(predicate).length;
  for (const candidate of sortedCandidates(candidates).filter(predicate)) {
    if (selected.size >= config.totalCards || current >= minimum) {
      return;
    }

    const sizeBefore = selected.size;
    addCandidate(selected, counts, candidate, config, reason);
    if (selected.size > sizeBefore) {
      current += 1;
    }
  }
}

export function buildCubeCandidates(
  rows: readonly CandidatePoolCardInput[],
  cards: readonly PersistedCardRecord[],
  historicalScores: readonly HistoricalCardScoreRow[] = [],
  reconstructionTargets: readonly ArchetypeReconstructionTargetRow[] = []
): readonly CubeCandidateCard[] {
  const cardsByName = new Map(cards.map((card) => [card.canonicalName, card]));
  const historicalScoresByName = new Map(historicalScores.map((score) => [score.cardName, score]));
  const targetsByName = new Map<string, ArchetypeReconstructionTargetRow[]>();
  for (const target of reconstructionTargets) {
    targetsByName.set(target.cardName, [...(targetsByName.get(target.cardName) ?? []), target]);
  }
  const rowsByCard = new Map<string, CandidatePoolCardInput[]>();

  for (const row of rows) {
    rowsByCard.set(row.cardName, [...(rowsByCard.get(row.cardName) ?? []), row]);
  }

  return [...rowsByCard.entries()].map(([cardName, candidateRows]) => {
    const card = cardsByName.get(cardName);
    const pools = unique(candidateRows.map((row) => row.pool));
    const roles = unique(candidateRows.flatMap((row) => row.roles));
    const best = [...candidateRows].sort((a, b) => b.score - a.score || a.pool.localeCompare(b.pool))[0];
    const historicalScore = historicalScoresByName.get(cardName);
    const targets = targetsByName.get(cardName) ?? [];

    return {
      card,
      cardName,
      explanation: [
        historicalScore ? `historical=${historicalScore.historicalRole}:${formatNumber(historicalScore.modernLegacyScore)}` : "",
        targets.length > 0 ? `reconstruction=${unique(targets.map((target) => `${target.archetypeFamily}@${target.periodId}:${target.targetRole}`)).join("|")}` : "",
        `selected as ${best?.pool ?? "candidate"}`,
        `pools=${pools.join("|")}`,
        `roles=${roles.join("|") || "none"}`,
        best?.explanation ?? ""
      ].filter((part) => part.length > 0).join(" "),
      historicalRole: historicalScore?.historicalRole,
      historicalScore: historicalScore?.modernLegacyScore,
      pools,
      reconstructionPeriods: unique(targets.map((target) => target.periodId)),
      reconstructionRoles: unique(targets.map((target) => target.targetRole)),
      roles,
      score: Math.max(...candidateRows.map((row) => row.score), historicalScore?.modernLegacyScore ?? 0),
      section: classifySection(card, pools)
    };
  });
}

function addCandidate(
  selected: Map<string, CubeCandidateCard>,
  counts: Map<CubeSection, number>,
  candidate: CubeCandidateCard,
  config: CubeGeneratorConfig,
  reason: string
): void {
  if (selected.has(candidate.cardName)) {
    return;
  }
  if ((counts.get(candidate.section) ?? 0) >= config.targets[candidate.section]) {
    return;
  }

  selected.set(candidate.cardName, {
    ...candidate,
    explanation: `${reason}: ${candidate.explanation}`
  });
  counts.set(candidate.section, (counts.get(candidate.section) ?? 0) + 1);
}

function sortedCandidates(candidates: readonly CubeCandidateCard[]): readonly CubeCandidateCard[] {
  return [...candidates].sort((a, b) => b.score - a.score || a.section.localeCompare(b.section) || a.cardName.localeCompare(b.cardName));
}

function sortedHistoricalCandidates(candidates: readonly CubeCandidateCard[]): readonly CubeCandidateCard[] {
  return [...candidates].sort(
    (a, b) =>
      (b.historicalScore ?? 0) - (a.historicalScore ?? 0) ||
      b.score - a.score ||
      b.reconstructionPeriods.length - a.reconstructionPeriods.length ||
      a.cardName.localeCompare(b.cardName)
  );
}

function classifySection(card: PersistedCardRecord | undefined, pools: readonly CandidatePool[]): CubeSection {
  const typeLine = card?.typeLine?.toLowerCase() ?? "";
  if (pools.includes("lands") || typeLine.includes("land")) {
    return "Lands";
  }

  const identity = card?.colorIdentity.length ? card.colorIdentity : card?.colors ?? [];
  const uniqueColors = unique(identity);
  if (uniqueColors.length > 1) {
    return "Gold";
  }
  if (uniqueColors.length === 0) {
    return "Colorless";
  }

  return colorSection(uniqueColors[0] ?? "");
}

function colorSection(color: string): CubeSection {
  if (color === "W") {
    return "White";
  }
  if (color === "U") {
    return "Blue";
  }
  if (color === "B") {
    return "Black";
  }
  if (color === "R") {
    return "Red";
  }
  if (color === "G") {
    return "Green";
  }

  return "Colorless";
}

function initialSectionCounts(): Map<CubeSection, number> {
  return new Map(Object.keys(defaultTargets).map((section) => [section as CubeSection, 0]));
}

function writeCubeCsv(filePath: string, rows: readonly CubeRunCardInput[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "position,card_name,roles,reason",
      ...rows.map((row) => [String(row.position + 1), row.cardName, row.roles.join("|"), row.reason].map(csvEscape).join(","))
    ].join("\n") + "\n"
  );
}

function mergeConfig(options: GenerateCubeOptions): CubeGeneratorConfig {
  const targets = {
    ...defaultTargets,
    ...(options.targets ?? {})
  };

  return {
    counterspellNamePatterns: options.counterspellNamePatterns ?? defaultConfig.counterspellNamePatterns,
    minimumArchetypeIcons: options.minimumArchetypeIcons ?? defaultConfig.minimumArchetypeIcons,
    minimumCounterspells: options.minimumCounterspells ?? defaultConfig.minimumCounterspells,
    minimumFormatPillars: options.minimumFormatPillars ?? defaultConfig.minimumFormatPillars,
    minimumRepresentedPeriods: options.minimumRepresentedPeriods ?? defaultConfig.minimumRepresentedPeriods,
    minimumRemoval: options.minimumRemoval ?? defaultConfig.minimumRemoval,
    minimumSweepers: options.minimumSweepers ?? defaultConfig.minimumSweepers,
    mode: options.mode ?? defaultConfig.mode,
    sweeperNamePatterns: options.sweeperNamePatterns ?? defaultConfig.sweeperNamePatterns,
    targets,
    totalCards: options.totalCards ?? Object.values(targets).reduce((total, value) => total + value, 0)
  };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/g, "").replace(/\.$/, "");
}

function matchesName(candidate: CubeCandidateCard, patterns: readonly string[]): boolean {
  const cardName = candidate.cardName.toLowerCase();
  return patterns.some((pattern) => cardName.includes(pattern.toLowerCase()));
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function csvEscape(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, "\"\"")}"`;
}
