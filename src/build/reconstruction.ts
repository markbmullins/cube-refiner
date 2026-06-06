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
  readonly configHash?: string;
  readonly enabledArchetypeFamilies: readonly string[];
  readonly disabledArchetypeFamilies: readonly string[];
  readonly sharedGlueBonus: number;
  readonly parasiticPackageCaps: Readonly<Record<string, number>>;
  readonly manualOverrides: readonly {
    readonly archetypeFamily: string;
    readonly cardName: string;
    readonly targetRole: ReconstructionTargetRole;
    readonly periodId?: string;
    readonly importance?: number;
  }[];
  readonly perArchetype: Readonly<Record<string, {
    readonly minimumReconstructionScore?: number;
    readonly minimumCoreCards?: number;
    readonly minimumSupportCards?: number;
    readonly minimumSignposts?: number;
    readonly periodIds?: readonly string[];
  }>>;
  readonly ecosystemDiversity: {
    readonly minimumReconstructedArchetypeFamilies: number;
    readonly minimumRepresentedPeriods: number;
    readonly minimumSharedCardEfficiency: number;
    readonly maximumSingleArchetypeDominance: number;
  };
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
  disabledArchetypeFamilies: [],
  ecosystemDiversity: {
    maximumSingleArchetypeDominance: 1,
    minimumReconstructedArchetypeFamilies: 1,
    minimumRepresentedPeriods: 1,
    minimumSharedCardEfficiency: 0
  },
  enabledArchetypeFamilies: [],
  manualOverrides: [],
  parasiticPackageCaps: {},
  perArchetype: {},
  reconstructionThreshold: 0.5,
  sharedGlueBonus: 0,
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
    configHash: options.configHash,
    disabledArchetypeFamilies: options.disabledArchetypeFamilies ?? defaultConfig.disabledArchetypeFamilies,
    ecosystemDiversity: {
      ...defaultConfig.ecosystemDiversity,
      ...(options.ecosystemDiversity ?? {})
    },
    enabledArchetypeFamilies: options.enabledArchetypeFamilies ?? defaultConfig.enabledArchetypeFamilies,
    manualOverrides: options.manualOverrides ?? defaultConfig.manualOverrides,
    parasiticPackageCaps: options.parasiticPackageCaps ?? defaultConfig.parasiticPackageCaps,
    perArchetype: options.perArchetype ?? defaultConfig.perArchetype,
    reconstructionThreshold: options.reconstructionThreshold ?? defaultConfig.reconstructionThreshold,
    sharedGlueBonus: options.sharedGlueBonus ?? defaultConfig.sharedGlueBonus,
    signpostShare: options.signpostShare ?? defaultConfig.signpostShare,
    supportShare: options.supportShare ?? defaultConfig.supportShare
  };
}

export function deriveReconstructionTargets(
  rows: readonly CardPeriodMatrixRow[],
  pipelineRunId: string,
  options: Partial<ReconstructionConfig> = defaultConfig
): readonly ArchetypeReconstructionTargetRow[] {
  const config = mergeConfig(options);
  const derived = rows.flatMap((row) =>
    row.archetypeFamilies
      .filter((archetypeFamily) => isArchetypeEnabled(archetypeFamily, row.periodId, config))
      .map((archetypeFamily) => {
        const role = roleFor(row, config);
        return {
          archetypeFamily,
          cardName: row.cardName,
          configHash: config.configHash,
          importance: importanceFor(row, config),
          periodId: row.periodId,
          pipelineRunId,
          targetRole: role
        };
      })
  );
  const manualTargets = config.manualOverrides.flatMap((override) => {
    const periodIds = override.periodId ? [override.periodId] : unique(derived.filter((target) => target.archetypeFamily === override.archetypeFamily).map((target) => target.periodId));
    return periodIds.map((periodId) => ({
      archetypeFamily: override.archetypeFamily,
      cardName: override.cardName,
      configHash: config.configHash,
      importance: override.importance ?? 1,
      periodId,
      pipelineRunId,
      targetRole: override.targetRole
    }));
  });
  return dedupeTargets([...derived, ...manualTargets]);
}

export function evaluateTargetsForCube(
  targets: readonly ArchetypeReconstructionTargetRow[],
  cubeCards: ReadonlySet<string>,
  cubeRunId: string,
  pipelineRunId: string,
  options: Partial<ReconstructionConfig> = defaultConfig
): {
  readonly rows: readonly CubeArchetypeReconstructionRow[];
  readonly summary: EcosystemDiversitySummaryRow;
} {
  const config = mergeConfig(options);
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
    const archetypeConfig = config.perArchetype[archetypeFamily] ?? {};
    const includedCoreCards = included.filter((target) => target.targetRole === "core").length;
    const includedSupportCards = included.filter((target) => target.targetRole === "support").length;
    const includedSignposts = included.filter((target) => target.targetRole === "signpost").length;
    const threshold = archetypeConfig.minimumReconstructionScore ?? config.reconstructionThreshold;
    const warnings = [
      ...(missingCoreCards.length > 0 ? [`Missing core cards: ${missingCoreCards.join("|")}`] : []),
      ...(reconstructionScore < threshold ? [`${archetypeFamily} below configured reconstruction score ${formatNumber(threshold)}`] : []),
      ...(includedCoreCards < (archetypeConfig.minimumCoreCards ?? 0) ? [`${archetypeFamily} below configured core card minimum ${archetypeConfig.minimumCoreCards}`] : []),
      ...(includedSupportCards < (archetypeConfig.minimumSupportCards ?? 0) ? [`${archetypeFamily} below configured support card minimum ${archetypeConfig.minimumSupportCards}`] : []),
      ...(includedSignposts < (archetypeConfig.minimumSignposts ?? 0) ? [`${archetypeFamily} below configured signpost minimum ${archetypeConfig.minimumSignposts}`] : []),
      ...parasiticWarnings(group, included, config)
    ];
    return {
      archetypeFamily,
      configHash: config.configHash,
      cubeRunId,
      includedImportance,
      includedTargets: included.length,
      missingCoreCards,
      periodId,
      pipelineRunId,
      reconstructionScore,
      totalImportance,
      totalTargets: group.length,
      warnings
    };
  });

  const representedRows = rows.filter((row) => row.reconstructionScore >= (config.perArchetype[row.archetypeFamily]?.minimumReconstructionScore ?? config.reconstructionThreshold));
  const sharedIncludedCards = new Set(
    targets
      .filter((target) => cubeCards.has(target.cardName))
      .reduce((cards, target) => {
        const count = targets.filter((candidate) => candidate.cardName === target.cardName).length;
        return count > 1 ? [...cards, target.cardName] : cards;
      }, [] as string[])
  );
  const includedTargetCards = new Set(targets.filter((target) => cubeCards.has(target.cardName)).map((target) => target.cardName));
  const archetypeIncludedCounts = countIncludedByArchetype(targets, cubeCards);
  const totalIncludedTargets = [...archetypeIncludedCounts.values()].reduce((total, count) => total + count, 0);
  const singleArchetypeDominance = totalIncludedTargets === 0 ? 0 : Math.max(0, ...archetypeIncludedCounts.values()) / totalIncludedTargets;

  return {
    rows: rows.sort((left, right) => left.periodId.localeCompare(right.periodId) || left.archetypeFamily.localeCompare(right.archetypeFamily)),
    summary: {
      archetypesAboveThreshold: new Set(representedRows.map((row) => row.archetypeFamily)).size,
      configHash: config.configHash,
      cubeRunId,
      periodsRepresented: new Set(representedRows.map((row) => row.periodId)).size,
      pipelineRunId,
      sharedCardEfficiency: includedTargetCards.size === 0 ? 0 : sharedIncludedCards.size / includedTargetCards.size,
      summary: {
        ecosystemWarnings: ecosystemWarnings(
          new Set(representedRows.map((row) => row.archetypeFamily)).size,
          new Set(representedRows.map((row) => row.periodId)).size,
          includedTargetCards.size === 0 ? 0 : sharedIncludedCards.size / includedTargetCards.size,
          singleArchetypeDominance,
          config
        ),
        reconstructionThreshold: config.reconstructionThreshold,
        singleArchetypeDominance
      }
    }
  };
}

function isArchetypeEnabled(archetypeFamily: string, periodId: string, config: ReconstructionConfig): boolean {
  if (config.enabledArchetypeFamilies.length > 0 && !config.enabledArchetypeFamilies.includes(archetypeFamily)) {
    return false;
  }
  if (config.disabledArchetypeFamilies.includes(archetypeFamily)) {
    return false;
  }
  const periodIds = config.perArchetype[archetypeFamily]?.periodIds;
  return !periodIds || periodIds.includes(periodId);
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
  return row.metagameShare * roleMultiplier + (role === "glue" ? config.sharedGlueBonus : 0);
}

function dedupeTargets(targets: readonly ArchetypeReconstructionTargetRow[]): readonly ArchetypeReconstructionTargetRow[] {
  return [...new Map(targets.map((target) => [`${target.periodId}\0${target.archetypeFamily}\0${target.cardName}`, target])).values()];
}

function parasiticWarnings(group: readonly ArchetypeReconstructionTargetRow[], included: readonly ArchetypeReconstructionTargetRow[], config: ReconstructionConfig): readonly string[] {
  const cap = config.parasiticPackageCaps[group[0]?.archetypeFamily ?? ""];
  if (cap === undefined) {
    return [];
  }
  return included.length > cap ? [`${group[0]?.archetypeFamily ?? "Archetype"} exceeds configured parasitic package cap ${cap}`] : [];
}

function countIncludedByArchetype(targets: readonly ArchetypeReconstructionTargetRow[], cubeCards: ReadonlySet<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const target of targets.filter((entry) => cubeCards.has(entry.cardName))) {
    counts.set(target.archetypeFamily, (counts.get(target.archetypeFamily) ?? 0) + 1);
  }
  return counts;
}

function ecosystemWarnings(
  reconstructedArchetypes: number,
  representedPeriods: number,
  sharedEfficiency: number,
  singleArchetypeDominance: number,
  config: ReconstructionConfig
): readonly string[] {
  return [
    ...(reconstructedArchetypes < config.ecosystemDiversity.minimumReconstructedArchetypeFamilies ? [`Reconstructed archetypes below configured minimum ${config.ecosystemDiversity.minimumReconstructedArchetypeFamilies}`] : []),
    ...(representedPeriods < config.ecosystemDiversity.minimumRepresentedPeriods ? [`Represented periods below configured minimum ${config.ecosystemDiversity.minimumRepresentedPeriods}`] : []),
    ...(sharedEfficiency < config.ecosystemDiversity.minimumSharedCardEfficiency ? [`Shared-card efficiency below configured minimum ${formatNumber(config.ecosystemDiversity.minimumSharedCardEfficiency)}`] : []),
    ...(singleArchetypeDominance > config.ecosystemDiversity.maximumSingleArchetypeDominance ? [`Single-archetype dominance above configured maximum ${formatNumber(config.ecosystemDiversity.maximumSingleArchetypeDominance)}`] : [])
  ];
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
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
