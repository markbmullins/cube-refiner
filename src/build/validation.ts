import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  listCubeRunCards,
  listPersistedCards,
  listValidationMetrics,
  listValidationWarnings,
  listValidationZeroSupportCards,
  replaceValidationMetrics,
  replaceValidationWarnings,
  replaceValidationZeroSupportCards,
  upsertValidationRun
} from "../db/index.js";
import type {
  CubeRunCardInput,
  PersistedCardRecord,
  ValidationMetricInput,
  ValidationWarningInput,
  ValidationZeroSupportCardInput
} from "../db/repository.js";
import type { CubeValidationWarningLevel } from "../types/contracts.js";
import type { CubeSection } from "./cube.js";

export type CubeValidationConfig = {
  readonly colorTargets: Readonly<Partial<Record<CubeSection, number>>>;
  readonly targetTolerance: number;
  readonly minimumRemoval: number;
  readonly minimumFixing: number;
  readonly minimumOneDrops: number;
  readonly minimumArchetypeSupport: number;
  readonly maximumZeroSupportCards: number;
  readonly minimumSupportPerArchetype: number;
  readonly maximumSupportPerArchetype: number;
};

export type ValidateCubeOptions = Partial<CubeValidationConfig> & {
  readonly configHash?: string;
  readonly cubeRunId: string;
  readonly outputCsvPath?: string;
  readonly validationRunId?: string;
};

export type ValidateCubeSummary = {
  readonly metrics: number;
  readonly outputCsvPath?: string;
  readonly status: CubeValidationWarningLevel;
  readonly validationRunId: string;
  readonly warnings: number;
  readonly zeroSupportCards: number;
};

export type CubeValidationReport = {
  readonly metrics: readonly ValidationMetricInput[];
  readonly warnings: readonly ValidationWarningInput[];
  readonly zeroSupportCards: readonly ValidationZeroSupportCardInput[];
};

export type ValidationCard = CubeRunCardInput & {
  readonly card?: PersistedCardRecord;
  readonly section: CubeSection;
};

const defaultValidationConfig: CubeValidationConfig = {
  colorTargets: {
    Black: 45,
    Blue: 45,
    Colorless: 35,
    Gold: 45,
    Green: 45,
    Lands: 55,
    Red: 45,
    White: 45
  },
  maximumSupportPerArchetype: 60,
  maximumZeroSupportCards: 25,
  minimumArchetypeSupport: 60,
  minimumFixing: 40,
  minimumOneDrops: 18,
  minimumRemoval: 35,
  minimumSupportPerArchetype: 2,
  targetTolerance: 5
};

const curveBuckets = [
  { key: "0", label: "MV 0", max: 0, min: 0 },
  { key: "1", label: "MV 1", max: 1, min: 1 },
  { key: "2", label: "MV 2", max: 2, min: 2 },
  { key: "3", label: "MV 3", max: 3, min: 3 },
  { key: "4", label: "MV 4", max: 4, min: 4 },
  { key: "5_plus", label: "MV 5+", max: Number.POSITIVE_INFINITY, min: 5 }
] as const;

export function validateCube(database: DatabaseSync, options: ValidateCubeOptions): ValidateCubeSummary {
  const config = mergeConfig(options);
  const validationRunId = options.validationRunId ?? randomUUID();
  const cards = buildValidationCards(listCubeRunCards(database, options.cubeRunId), listPersistedCards(database));
  const report = validateCubeCards(validationRunId, cards, config);
  const status = validationStatus(report.warnings);

  upsertValidationRun(database, {
    config,
    configHash: options.configHash,
    cubeRunId: options.cubeRunId,
    id: validationRunId,
    status,
    totalCards: cards.length
  });
  replaceValidationMetrics(database, validationRunId, report.metrics);
  replaceValidationWarnings(database, validationRunId, report.warnings);
  replaceValidationZeroSupportCards(database, validationRunId, report.zeroSupportCards);

  if (options.outputCsvPath) {
    writeValidationCsv(
      options.outputCsvPath,
      listValidationMetrics(database, validationRunId),
      listValidationWarnings(database, validationRunId),
      listValidationZeroSupportCards(database, validationRunId)
    );
  }

  return {
    metrics: report.metrics.length,
    outputCsvPath: options.outputCsvPath,
    status,
    validationRunId,
    warnings: report.warnings.length,
    zeroSupportCards: report.zeroSupportCards.length
  };
}

export function validateCubeCards(
  validationRunId: string,
  cards: readonly ValidationCard[],
  config: CubeValidationConfig = defaultValidationConfig
): CubeValidationReport {
  const metrics: ValidationMetricInput[] = [];
  const warnings: ValidationWarningInput[] = [];
  const colorCounts = countBy(cards, (card) => card.section);
  const removalCount = cards.filter((card) => hasReason(card, "removal")).length;
  const sweeperCount = cards.filter((card) => hasAnyName(card, ["wrath", "damnation", "supreme verdict", "anger of the gods"])).length;
  const fixingCount = cards.filter((card) => card.roles.includes("fixing") || card.section === "Lands").length;
  const oneDropCount = cards.filter(
    (card) => card.card?.manaValue !== undefined && card.card.manaValue <= 1 && card.section !== "Lands"
  ).length;
  const supportCount = cards.filter((card) => card.roles.includes("support")).length;
  const parasiticCount = cards.filter((card) => hasReason(card, "parasitic")).length;
  const creatureCount = cards.filter((card) => card.card?.typeLine?.toLowerCase().includes("creature")).length;
  const nonCreatureCount = cards.length - creatureCount;
  const zeroSupportCards = cards.filter((card) => !card.roles.includes("support"));
  const archetypeSupportCounts = countArchetypeSupport(cards);

  for (const [section, target] of Object.entries(config.colorTargets)) {
    const count = colorCounts.get(section as CubeSection) ?? 0;
    metrics.push(metric(validationRunId, `color.${section}`, `${section} count`, count, { section, target }));
    if (Math.abs(count - target) > config.targetTolerance) {
      warnings.push(
        warning(validationRunId, "warn", "color.target_miss", `${section} count ${count} misses target ${target}.`, {
          count,
          section,
          target
        })
      );
    }
  }

  for (const [section, bucket, count] of curveMetrics(cards)) {
    metrics.push(
      metric(validationRunId, `curve.${section}.${bucket.key}`, `${section} ${bucket.label}`, count, {
        bucket: bucket.key,
        section
      })
    );
  }

  metrics.push(metric(validationRunId, "ratio.creature", "Creature count", creatureCount));
  metrics.push(metric(validationRunId, "ratio.noncreature", "Noncreature count", nonCreatureCount));
  metrics.push(metric(validationRunId, "role.removal", "Removal count", removalCount));
  metrics.push(metric(validationRunId, "role.sweeper", "Sweeper count", sweeperCount));
  metrics.push(metric(validationRunId, "role.fixing", "Fixing count", fixingCount));
  metrics.push(metric(validationRunId, "curve.one_drop", "One-drop count", oneDropCount));
  metrics.push(metric(validationRunId, "role.support", "Archetype support count", supportCount));
  metrics.push(metric(validationRunId, "role.parasitic", "Parasitic card count", parasiticCount));
  metrics.push(metric(validationRunId, "support.zero_count", "Cards with zero archetype support", zeroSupportCards.length));

  for (const [archetype, count] of [...archetypeSupportCounts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    metrics.push(metric(validationRunId, `support.archetype.${slug(archetype)}`, `${archetype} support count`, count, { archetype }));
    if (count < config.minimumSupportPerArchetype) {
      warnings.push(
        warning(
          validationRunId,
          "warn",
          "support.archetype_under_supported",
          `${archetype} has only ${count} support cards.`,
          { archetype, count, minimum: config.minimumSupportPerArchetype }
        )
      );
    }
    if (count > config.maximumSupportPerArchetype) {
      warnings.push(
        warning(
          validationRunId,
          "warn",
          "support.archetype_over_supported",
          `${archetype} has ${count} support cards.`,
          { archetype, count, maximum: config.maximumSupportPerArchetype }
        )
      );
    }
  }

  if (removalCount < config.minimumRemoval) {
    warnings.push(
      warning(validationRunId, "warn", "role.low_removal", `Removal count ${removalCount} below minimum ${config.minimumRemoval}.`, {
        minimum: config.minimumRemoval,
        removalCount
      })
    );
  }
  if (fixingCount < config.minimumFixing) {
    warnings.push(
      warning(validationRunId, "warn", "role.low_fixing", `Fixing count ${fixingCount} below minimum ${config.minimumFixing}.`, {
        fixingCount,
        minimum: config.minimumFixing
      })
    );
  }
  if (oneDropCount < config.minimumOneDrops) {
    warnings.push(
      warning(validationRunId, "warn", "curve.low_one_drops", `One-drop count ${oneDropCount} below minimum ${config.minimumOneDrops}.`, {
        minimum: config.minimumOneDrops,
        oneDropCount
      })
    );
  }
  if (supportCount < config.minimumArchetypeSupport) {
    warnings.push(
      warning(
        validationRunId,
        "warn",
        "support.low",
        `Archetype support count ${supportCount} below minimum ${config.minimumArchetypeSupport}.`,
        { minimum: config.minimumArchetypeSupport, supportCount }
      )
    );
  }
  if (zeroSupportCards.length > config.maximumZeroSupportCards) {
    warnings.push(
      warning(validationRunId, "warn", "support.zero_support", `${zeroSupportCards.length} cards have zero archetype support.`, {
        cards: zeroSupportCards.map((card) => card.cardName),
        maximum: config.maximumZeroSupportCards
      })
    );
  }

  return {
    metrics,
    warnings,
    zeroSupportCards: zeroSupportCards.map((card) => ({
      cardName: card.cardName,
      position: card.position,
      reason: card.reason,
      section: card.section,
      validationRunId
    }))
  };
}

function buildValidationCards(
  cubeCards: readonly CubeRunCardInput[],
  cards: readonly PersistedCardRecord[]
): readonly ValidationCard[] {
  const cardsByName = new Map(cards.map((card) => [card.canonicalName, card]));
  return cubeCards.map((cubeCard) => {
    const card = cardsByName.get(cubeCard.cardName);
    return {
      ...cubeCard,
      card,
      section: classifySection(card)
    };
  });
}

function classifySection(card: PersistedCardRecord | undefined): CubeSection {
  const typeLine = card?.typeLine?.toLowerCase() ?? "";
  if (typeLine.includes("land")) {
    return "Lands";
  }
  const identity = card?.colorIdentity.length ? card.colorIdentity : card?.colors ?? [];
  const uniqueColors = [...new Set(identity)];
  if (uniqueColors.length > 1) {
    return "Gold";
  }
  if (uniqueColors.length === 0) {
    return "Colorless";
  }

  return colorSection(uniqueColors[0] ?? "");
}

function colorSection(color: string): CubeSection {
  if (color === "W") return "White";
  if (color === "U") return "Blue";
  if (color === "B") return "Black";
  if (color === "R") return "Red";
  if (color === "G") return "Green";
  return "Colorless";
}

function writeValidationCsv(
  filePath: string,
  metrics: readonly ValidationMetricInput[],
  warnings: readonly ValidationWarningInput[],
  zeroSupportCards: readonly ValidationZeroSupportCardInput[]
): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "row_type,level,code,message,value,metadata_json",
      ...metrics.map((row) =>
        ["metric", "pass", row.metricKey, row.label, String(row.value), JSON.stringify(row.metadata ?? {})].map(csvEscape).join(",")
      ),
      ...warnings.map((row) =>
        ["warning", row.level, row.code, row.message, "", JSON.stringify(row.metadata ?? {})].map(csvEscape).join(",")
      ),
      ...zeroSupportCards.map((row) =>
        [
          "zero_support_card",
          "warn",
          "support.zero_support_card",
          row.cardName,
          "",
          JSON.stringify({ position: row.position, reason: row.reason, section: row.section })
        ]
          .map(csvEscape)
          .join(",")
      )
    ].join("\n") + "\n"
  );
}

function metric(
  validationRunId: string,
  metricKey: string,
  label: string,
  value: number,
  metadata: unknown = {}
): ValidationMetricInput {
  return {
    label,
    metadata,
    metricKey,
    validationRunId,
    value
  };
}

function warning(
  validationRunId: string,
  level: "warn" | "fail",
  code: string,
  message: string,
  metadata: unknown
): ValidationWarningInput {
  return { code, level, message, metadata, validationRunId };
}

function validationStatus(rows: readonly ValidationWarningInput[]): CubeValidationWarningLevel {
  if (rows.some((row) => row.level === "fail")) return "fail";
  if (rows.some((row) => row.level === "warn")) return "warn";
  return "pass";
}

function countBy<T>(items: readonly T[], keyForItem: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyForItem(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function curveMetrics(cards: readonly ValidationCard[]): readonly [CubeSection, (typeof curveBuckets)[number], number][] {
  const rows: [CubeSection, (typeof curveBuckets)[number], number][] = [];
  const sections = [...new Set(cards.map((card) => card.section))].sort();
  for (const section of sections) {
    const sectionCards = cards.filter((card) => card.section === section && card.section !== "Lands");
    for (const bucket of curveBuckets) {
      rows.push([
        section,
        bucket,
        sectionCards.filter(
          (card) => card.card?.manaValue !== undefined && card.card.manaValue >= bucket.min && card.card.manaValue <= bucket.max
        ).length
      ]);
    }
  }

  return rows;
}

function countArchetypeSupport(cards: readonly ValidationCard[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of cards.filter((entry) => entry.roles.includes("support") || entry.roles.includes("signpost"))) {
    for (const archetype of extractTopArchetypes(card.reason)) {
      counts.set(archetype, (counts.get(archetype) ?? 0) + 1);
    }
  }

  return counts;
}

function extractTopArchetypes(reason: string): readonly string[] {
  const topMatch = /\btop=/.exec(reason);
  if (!topMatch) {
    return [];
  }

  return reason
    .slice(topMatch.index + "top=".length)
    .trim()
    .split("|")
    .map((entry) => entry.replace(/:[^:]*$/, "").trim())
    .filter((entry): entry is string => entry !== undefined && entry.length > 0);
}

function hasReason(card: CubeRunCardInput, value: string): boolean {
  return card.reason.toLowerCase().includes(value);
}

function hasAnyName(card: CubeRunCardInput, values: readonly string[]): boolean {
  const cardName = card.cardName.toLowerCase();
  return values.some((value) => cardName.includes(value));
}

function mergeConfig(options: ValidateCubeOptions): CubeValidationConfig {
  return {
    colorTargets: {
      ...defaultValidationConfig.colorTargets,
      ...(options.colorTargets ?? {})
    },
    maximumSupportPerArchetype: options.maximumSupportPerArchetype ?? defaultValidationConfig.maximumSupportPerArchetype,
    maximumZeroSupportCards: options.maximumZeroSupportCards ?? defaultValidationConfig.maximumZeroSupportCards,
    minimumArchetypeSupport: options.minimumArchetypeSupport ?? defaultValidationConfig.minimumArchetypeSupport,
    minimumFixing: options.minimumFixing ?? defaultValidationConfig.minimumFixing,
    minimumOneDrops: options.minimumOneDrops ?? defaultValidationConfig.minimumOneDrops,
    minimumRemoval: options.minimumRemoval ?? defaultValidationConfig.minimumRemoval,
    minimumSupportPerArchetype: options.minimumSupportPerArchetype ?? defaultValidationConfig.minimumSupportPerArchetype,
    targetTolerance: options.targetTolerance ?? defaultValidationConfig.targetTolerance
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function csvEscape(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, "\"\"")}"`;
}
