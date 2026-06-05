import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  listPersistedCandidatePoolCards,
  listPersistedCards,
  listPersistedCardScores,
  listPersistedMatrixRows,
  replaceCandidatePoolCards,
  upsertPipelineRun
} from "../db/index.js";
import type {
  CandidatePoolCardInput,
  CardArchetypeMatrixInput,
  CardScoreInput,
  PersistedCardRecord
} from "../db/repository.js";
import type { CandidatePool, CubeCardRole } from "../types/contracts.js";

export type CandidatePoolConfig = {
  readonly autoIncludeMinCubeScore: number;
  readonly glueMinScore: number;
  readonly signpostMinScore: number;
  readonly parasiticMinScore: number;
  readonly sideboardOnlyMinShare: number;
  readonly oneDropMaxManaValue: number;
  readonly removalNamePatterns: readonly string[];
  readonly sweeperNamePatterns: readonly string[];
  readonly threatTypePatterns: readonly string[];
};

export type GenerateCandidatePoolsOptions = Partial<CandidatePoolConfig> & {
  readonly pipelineRunId: string;
  readonly outputDir?: string;
};

export type GenerateCandidatePoolsSummary = {
  readonly exportedCsvPaths: Readonly<Record<CandidatePool, string>>;
  readonly pipelineRunId: string;
  readonly persistedRows: number;
};

type CandidateContext = {
  readonly card?: PersistedCardRecord;
  readonly score: CardScoreInput;
  readonly sideboardShare: number;
  readonly topArchetypes: readonly string[];
};

const candidatePools: readonly CandidatePool[] = [
  "auto_includes",
  "glue_cards",
  "signpost_cards",
  "parasitic_review",
  "sideboard_cards",
  "lands",
  "removal",
  "threats"
] as const;

const defaultConfig: CandidatePoolConfig = {
  autoIncludeMinCubeScore: 0.6,
  glueMinScore: 2,
  oneDropMaxManaValue: 1,
  parasiticMinScore: 0.05,
  removalNamePatterns: ["bolt", "path", "push", "terminate", "decay", "dismember", "destroy", "exile", "damage"],
  sideboardOnlyMinShare: 0.6,
  signpostMinScore: 0.5,
  sweeperNamePatterns: ["wrath", "anger of the gods", "damnation", "supreme verdict", "engineered explosives"],
  threatTypePatterns: ["creature", "planeswalker", "battle"]
};

export function generateCandidatePools(
  database: DatabaseSync,
  options: GenerateCandidatePoolsOptions
): GenerateCandidatePoolsSummary {
  const config = mergeConfig(options);
  const configHash = stableConfigHash({ ...config, pipelineRunId: options.pipelineRunId, stage: "candidate-pools" });
  upsertPipelineRun(database, {
    configHash,
    id: options.pipelineRunId,
    status: "running"
  });

  try {
    const scores = listPersistedCardScores(database, options.pipelineRunId);
    const matrixRows = listPersistedMatrixRows(database, options.pipelineRunId);
    const cardsByName = new Map(listPersistedCards(database).map((card) => [card.canonicalName, card]));
    const contexts = scores.map((score) => buildCandidateContext(score, matrixRows, cardsByName));
    const candidates = contexts.flatMap((context) => classifyCandidatePools(context, config));

    replaceCandidatePoolCards(database, options.pipelineRunId, candidates);
    const persistedRows = listPersistedCandidatePoolCards(database, options.pipelineRunId);
    const exportedCsvPaths = options.outputDir ? exportCandidatePoolCsvs(options.outputDir, persistedRows, contexts) : emptyCsvPathMap();

    upsertPipelineRun(database, {
      completedAt: new Date().toISOString(),
      configHash,
      id: options.pipelineRunId,
      status: "completed"
    });

    return {
      exportedCsvPaths,
      persistedRows: persistedRows.length,
      pipelineRunId: options.pipelineRunId
    };
  } catch (error) {
    upsertPipelineRun(database, {
      completedAt: new Date().toISOString(),
      configHash,
      id: options.pipelineRunId,
      status: "failed"
    });
    throw error;
  }
}

export function classifyCandidatePools(
  context: CandidateContext,
  config: CandidatePoolConfig = defaultConfig
): readonly CandidatePoolCardInput[] {
  const rows: CandidatePoolCardInput[] = [];
  const { card, score } = context;
  const typeLine = card?.typeLine?.toLowerCase() ?? "";
  const cardName = score.cardName.toLowerCase();
  const roles = classifyRoles(context, config);

  if (score.cubeScore >= config.autoIncludeMinCubeScore) {
    rows.push(candidateRow(context, "auto_includes", score.cubeScore, roles, "High composite cube score."));
  }

  if (score.glueScore >= config.glueMinScore) {
    rows.push(candidateRow(context, "glue_cards", score.weightedGlueScore, roles, "Appears across multiple archetype families."));
  }

  if (score.signpostScore >= config.signpostMinScore) {
    rows.push(candidateRow(context, "signpost_cards", score.signpostScore, roles, "High affinity and exclusivity."));
  }

  if (score.parasiticScore >= config.parasiticMinScore) {
    rows.push(candidateRow(context, "parasitic_review", score.parasiticScore, roles, "High signpost score with low glue score."));
  }

  if (context.sideboardShare >= config.sideboardOnlyMinShare) {
    rows.push(candidateRow(context, "sideboard_cards", context.sideboardShare, roles, "Mostly appears in sideboards."));
  }

  if (typeLine.includes("land")) {
    rows.push(candidateRow(context, "lands", score.cubeScore, uniqueRoles([...roles, "fixing"]), "Land or fixing candidate."));
  }

  if (isRemoval(cardName, typeLine, config) || isSweeper(cardName, config)) {
    rows.push(candidateRow(context, "removal", score.cubeScore, uniqueRoles([...roles, "role"]), "Removal, sweeper, or interaction candidate."));
  }

  if (isThreat(typeLine, config)) {
    rows.push(candidateRow(context, "threats", score.cubeScore, uniqueRoles([...roles, "role"]), "Threat candidate."));
  }

  return rows;
}

export function classifyRoles(context: CandidateContext, config: CandidatePoolConfig = defaultConfig): readonly CubeCardRole[] {
  const roles: CubeCardRole[] = [];
  const typeLine = context.card?.typeLine?.toLowerCase() ?? "";

  if (context.score.glueScore >= config.glueMinScore) {
    roles.push("glue");
  }
  if (context.score.signpostScore >= config.signpostMinScore) {
    roles.push("signpost");
  }
  if (typeLine.includes("land")) {
    roles.push("fixing");
  }
  if ((context.card?.manaValue ?? Number.POSITIVE_INFINITY) <= config.oneDropMaxManaValue) {
    roles.push("curve");
  }
  if (context.topArchetypes.length > 0) {
    roles.push("support");
  }

  return uniqueRoles(roles);
}

function buildCandidateContext(
  score: CardScoreInput,
  matrixRows: readonly CardArchetypeMatrixInput[],
  cardsByName: ReadonlyMap<string, PersistedCardRecord>
): CandidateContext {
  const rowsForCard = matrixRows.filter((row) => row.cardName === score.cardName);
  const mainboardCopies = rowsForCard.reduce((total, row) => total + row.mainboardCopies, 0);
  const sideboardCopies = rowsForCard.reduce((total, row) => total + row.sideboardCopies, 0);
  const totalCopies = mainboardCopies + sideboardCopies;

  return {
    card: cardsByName.get(score.cardName),
    score,
    sideboardShare: totalCopies === 0 ? 0 : sideboardCopies / totalCopies,
    topArchetypes: rowsForCard
      .filter((row) => row.affinity > 0)
      .sort((a, b) => b.affinity - a.affinity || a.archetypeFamily.localeCompare(b.archetypeFamily))
      .slice(0, 3)
      .map((row) => `${row.archetypeFamily}:${formatNumber(row.affinity)}`)
  };
}

function candidateRow(
  context: CandidateContext,
  pool: CandidatePool,
  score: number,
  roles: readonly CubeCardRole[],
  reason: string
): CandidatePoolCardInput {
  return {
    cardName: context.score.cardName,
    explanation: [
      reason,
      `cube=${formatNumber(context.score.cubeScore)}`,
      `glue=${formatNumber(context.score.glueScore)}`,
      `signpost=${formatNumber(context.score.signpostScore)}`,
      `parasitic=${formatNumber(context.score.parasiticScore)}`,
      `top=${context.topArchetypes.join("|") || "none"}`
    ].join(" "),
    pipelineRunId: context.score.pipelineRunId,
    pool,
    roles,
    score
  };
}

function exportCandidatePoolCsvs(
  outputDir: string,
  rows: readonly CandidatePoolCardInput[],
  contexts: readonly CandidateContext[]
): Readonly<Record<CandidatePool, string>> {
  mkdirSync(outputDir, { recursive: true });
  const contextByCard = new Map(contexts.map((context) => [context.score.cardName, context]));
  const paths = emptyCsvPathMap(outputDir);

  for (const pool of candidatePools) {
    const filePath = paths[pool];
    const poolRows = rows.filter((row) => row.pool === pool);
    writeCandidatePoolCsv(filePath, poolRows, contextByCard);
  }

  return paths;
}

function writeCandidatePoolCsv(
  filePath: string,
  rows: readonly CandidatePoolCardInput[],
  contextByCard: ReadonlyMap<string, CandidateContext>
): void {
  writeFileSync(
    filePath,
    [
      "card_name,pool,score,cube_score,frequency,glue_score,signpost_score,parasitic_score,roles,top_archetypes,explanation",
      ...rows.map((row) => {
        const context = contextByCard.get(row.cardName);
        return [
          row.cardName,
          row.pool,
          formatNumber(row.score),
          formatNumber(context?.score.cubeScore ?? 0),
          formatNumber(context?.score.frequency ?? 0),
          formatNumber(context?.score.glueScore ?? 0),
          formatNumber(context?.score.signpostScore ?? 0),
          formatNumber(context?.score.parasiticScore ?? 0),
          row.roles.join("|"),
          context?.topArchetypes.join("|") ?? "",
          row.explanation
        ].map(csvEscape).join(",");
      })
    ].join("\n") + "\n"
  );
}

function isRemoval(cardName: string, typeLine: string, config: CandidatePoolConfig): boolean {
  return (
    (typeLine.includes("instant") || typeLine.includes("sorcery")) &&
    config.removalNamePatterns.some((pattern) => cardName.includes(pattern.toLowerCase()))
  );
}

function isSweeper(cardName: string, config: CandidatePoolConfig): boolean {
  return config.sweeperNamePatterns.some((pattern) => cardName.includes(pattern.toLowerCase()));
}

function isThreat(typeLine: string, config: CandidatePoolConfig): boolean {
  return config.threatTypePatterns.some((pattern) => typeLine.includes(pattern.toLowerCase()));
}

function mergeConfig(options: GenerateCandidatePoolsOptions): CandidatePoolConfig {
  return {
    ...defaultConfig,
    ...removeUndefined({
      autoIncludeMinCubeScore: options.autoIncludeMinCubeScore,
      glueMinScore: options.glueMinScore,
      oneDropMaxManaValue: options.oneDropMaxManaValue,
      parasiticMinScore: options.parasiticMinScore,
      sideboardOnlyMinShare: options.sideboardOnlyMinShare,
      signpostMinScore: options.signpostMinScore
    }),
    removalNamePatterns: options.removalNamePatterns ?? defaultConfig.removalNamePatterns,
    sweeperNamePatterns: options.sweeperNamePatterns ?? defaultConfig.sweeperNamePatterns,
    threatTypePatterns: options.threatTypePatterns ?? defaultConfig.threatTypePatterns
  };
}

function uniqueRoles(roles: readonly CubeCardRole[]): readonly CubeCardRole[] {
  return [...new Set(roles)];
}

function emptyCsvPathMap(outputDir = ""): Readonly<Record<CandidatePool, string>> {
  return Object.fromEntries(candidatePools.map((pool) => [pool, outputDir ? path.join(outputDir, `${pool}.csv`) : ""])) as Readonly<
    Record<CandidatePool, string>
  >;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
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
