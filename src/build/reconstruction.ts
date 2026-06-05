import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  listCubeRunCards,
  listPersistedCardPeriodMatrixRows,
  replaceArchetypeReconstructionTargets,
  replaceCubeArchetypeReconstructionRows
} from "../db/index.js";
import type {
  ArchetypeReconstructionTargetRow,
  CardPeriodMatrixRow,
  CubeArchetypeReconstructionRow,
  EcosystemDiversitySummaryRow,
  ReconstructionTargetRole
} from "../types/contracts.js";

export type ReconstructionConfig = {
  readonly coreShare: number;
  readonly supportShare: number;
  readonly signpostShare: number;
  readonly reconstructionThreshold: number;
};

export type EvaluateCubeReconstructionOptions = Partial<ReconstructionConfig> & {
  readonly cubeRunId: string;
  readonly pipelineRunId: string;
  readonly archetypeReconstructionCsvPath?: string;
  readonly eraCoverageCsvPath?: string;
  readonly ecosystemDiversityCsvPath?: string;
};

export type EvaluateCubeReconstructionSummary = {
  readonly cubeRunId: string;
  readonly pipelineRunId: string;
  readonly targets: number;
  readonly reconstructionRows: number;
  readonly archetypesAboveThreshold: number;
  readonly periodsRepresented: number;
  readonly sharedCardEfficiency: number;
};

const defaultConfig: ReconstructionConfig = {
  coreShare: 0.2,
  reconstructionThreshold: 0.5,
  signpostShare: 0.15,
  supportShare: 0.08
};

export function evaluateCubeReconstruction(
  database: DatabaseSync,
  options: EvaluateCubeReconstructionOptions
): EvaluateCubeReconstructionSummary {
  const config = mergeConfig(options);
  const periodRows = listPersistedCardPeriodMatrixRows(database, options.pipelineRunId);
  const targets = deriveReconstructionTargets(periodRows, options.pipelineRunId, config);
  replaceArchetypeReconstructionTargets(database, options.pipelineRunId, targets);

  const cubeCards = new Set(listCubeRunCards(database, options.cubeRunId).map((card) => card.cardName));
  const evaluation = evaluateTargetsForCube(targets, cubeCards, options.cubeRunId, options.pipelineRunId, config);
  replaceCubeArchetypeReconstructionRows(database, options.cubeRunId, options.pipelineRunId, evaluation.rows, evaluation.summary);

  if (options.archetypeReconstructionCsvPath) {
    writeReconstructionCsv(options.archetypeReconstructionCsvPath, evaluation.rows);
  }
  if (options.eraCoverageCsvPath) {
    writeEraCoverageCsv(options.eraCoverageCsvPath, evaluation.rows);
  }
  if (options.ecosystemDiversityCsvPath) {
    writeEcosystemCsv(options.ecosystemDiversityCsvPath, evaluation.summary);
  }

  return {
    archetypesAboveThreshold: evaluation.summary.archetypesAboveThreshold,
    cubeRunId: options.cubeRunId,
    periodsRepresented: evaluation.summary.periodsRepresented,
    pipelineRunId: options.pipelineRunId,
    reconstructionRows: evaluation.rows.length,
    sharedCardEfficiency: evaluation.summary.sharedCardEfficiency,
    targets: targets.length
  };
}

function mergeConfig(options: Partial<ReconstructionConfig>): ReconstructionConfig {
  return {
    coreShare: options.coreShare ?? defaultConfig.coreShare,
    reconstructionThreshold: options.reconstructionThreshold ?? defaultConfig.reconstructionThreshold,
    signpostShare: options.signpostShare ?? defaultConfig.signpostShare,
    supportShare: options.supportShare ?? defaultConfig.supportShare
  };
}

export function deriveReconstructionTargets(
  rows: readonly CardPeriodMatrixRow[],
  pipelineRunId: string,
  config: ReconstructionConfig = defaultConfig
): readonly ArchetypeReconstructionTargetRow[] {
  return rows.flatMap((row) =>
    row.archetypeFamilies.map((archetypeFamily) => ({
      archetypeFamily,
      cardName: row.cardName,
      importance: importanceFor(row, config),
      periodId: row.periodId,
      pipelineRunId,
      targetRole: roleFor(row, config)
    }))
  );
}

export function evaluateTargetsForCube(
  targets: readonly ArchetypeReconstructionTargetRow[],
  cubeCards: ReadonlySet<string>,
  cubeRunId: string,
  pipelineRunId: string,
  config: ReconstructionConfig = defaultConfig
): {
  readonly rows: readonly CubeArchetypeReconstructionRow[];
  readonly summary: EcosystemDiversitySummaryRow;
} {
  const grouped = new Map<string, ArchetypeReconstructionTargetRow[]>();
  for (const target of targets) {
    const key = `${target.periodId}\0${target.archetypeFamily}`;
    grouped.set(key, [...(grouped.get(key) ?? []), target]);
  }

  const rows = [...grouped.entries()].map(([key, group]) => {
    const [periodId = "", archetypeFamily = ""] = key.split("\0");
    const totalImportance = group.reduce((total, target) => total + target.importance, 0);
    const included = group.filter((target) => cubeCards.has(target.cardName));
    const includedImportance = included.reduce((total, target) => total + target.importance, 0);
    const missingCoreCards = group
      .filter((target) => target.targetRole === "core" && !cubeCards.has(target.cardName))
      .map((target) => target.cardName)
      .sort((left, right) => left.localeCompare(right));
    const reconstructionScore = totalImportance === 0 ? 0 : includedImportance / totalImportance;
    return {
      archetypeFamily,
      cubeRunId,
      includedImportance,
      includedTargets: included.length,
      missingCoreCards,
      periodId,
      pipelineRunId,
      reconstructionScore,
      totalImportance,
      totalTargets: group.length,
      warnings: missingCoreCards.length > 0 ? [`Missing core cards: ${missingCoreCards.join("|")}`] : []
    };
  });

  const representedRows = rows.filter((row) => row.reconstructionScore >= config.reconstructionThreshold);
  const sharedIncludedCards = new Set(
    targets
      .filter((target) => cubeCards.has(target.cardName))
      .reduce((cards, target) => {
        const count = targets.filter((candidate) => candidate.cardName === target.cardName).length;
        return count > 1 ? [...cards, target.cardName] : cards;
      }, [] as string[])
  );
  const includedTargetCards = new Set(targets.filter((target) => cubeCards.has(target.cardName)).map((target) => target.cardName));

  return {
    rows: rows.sort((left, right) => left.periodId.localeCompare(right.periodId) || left.archetypeFamily.localeCompare(right.archetypeFamily)),
    summary: {
      archetypesAboveThreshold: new Set(representedRows.map((row) => row.archetypeFamily)).size,
      cubeRunId,
      periodsRepresented: new Set(representedRows.map((row) => row.periodId)).size,
      pipelineRunId,
      sharedCardEfficiency: includedTargetCards.size === 0 ? 0 : sharedIncludedCards.size / includedTargetCards.size,
      summary: {
        reconstructionThreshold: config.reconstructionThreshold
      }
    }
  };
}

function roleFor(row: CardPeriodMatrixRow, config: ReconstructionConfig): ReconstructionTargetRole {
  if (row.archetypeFamilies.length > 1) {
    return "glue";
  }
  if (row.metagameShare >= config.coreShare) {
    return "core";
  }
  if (row.metagameShare >= config.signpostShare) {
    return "signpost";
  }
  if (row.metagameShare >= config.supportShare) {
    return "support";
  }
  return "optional";
}

function importanceFor(row: CardPeriodMatrixRow, config: ReconstructionConfig): number {
  const role = roleFor(row, config);
  const roleMultiplier = role === "core" ? 1 : role === "signpost" ? 0.85 : role === "glue" ? 0.75 : role === "support" ? 0.55 : 0.25;
  return row.metagameShare * roleMultiplier;
}

function writeReconstructionCsv(filePath: string, rows: readonly CubeArchetypeReconstructionRow[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "period_id,archetype_family,reconstruction_score,total_importance,included_importance,total_targets,included_targets,missing_core_cards,warnings",
      ...rows.map((row) =>
        [
          row.periodId,
          row.archetypeFamily,
          formatNumber(row.reconstructionScore),
          formatNumber(row.totalImportance),
          formatNumber(row.includedImportance),
          String(row.totalTargets),
          String(row.includedTargets),
          row.missingCoreCards.join("|"),
          row.warnings.join("|")
        ].map(csvEscape).join(",")
      )
    ].join("\n") + "\n"
  );
}

function writeEraCoverageCsv(filePath: string, rows: readonly CubeArchetypeReconstructionRow[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "period_id,represented_archetypes,average_reconstruction_score",
      ...[...new Set(rows.map((row) => row.periodId))].map((periodId) => {
        const periodRows = rows.filter((row) => row.periodId === periodId);
        return [
          periodId,
          periodRows.filter((row) => row.reconstructionScore > 0).map((row) => row.archetypeFamily).join("|"),
          formatNumber(periodRows.reduce((total, row) => total + row.reconstructionScore, 0) / Math.max(1, periodRows.length))
        ].map(csvEscape).join(",");
      })
    ].join("\n") + "\n"
  );
}

function writeEcosystemCsv(filePath: string, row: EcosystemDiversitySummaryRow): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "cube_run_id,pipeline_run_id,archetypes_above_threshold,periods_represented,shared_card_efficiency,summary",
      [
        row.cubeRunId,
        row.pipelineRunId,
        String(row.archetypesAboveThreshold),
        String(row.periodsRepresented),
        formatNumber(row.sharedCardEfficiency),
        JSON.stringify(row.summary)
      ].map(csvEscape).join(",")
    ].join("\n") + "\n"
  );
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
