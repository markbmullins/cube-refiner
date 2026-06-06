import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseHistoricalDateRange, type HistoricalDateRange } from "./historical.js";

export const defaultHistoricalModernConfigPath = path.join(process.cwd(), "data", "config", "historical-modern.default.json");

export type HistoricalPeriodModel = "standard_set_release";
export type HistoricalDatePolicy = "event_date_required";
export type HistoricalCollectorSource = "mtgtop8" | "mtgo" | "mtggoldfish";
export type HistoricalCollectionDateHandling = "discard" | "quarantine" | "persist_inactive";
export type HistoricalMissingSourceWarningPolicy = "ignore" | "warn" | "fail";
export type HistoricalScoringNormalizationConfig = {
  readonly eraScore: "count" | "share";
  readonly peakScore: "raw" | "sqrt";
  readonly longevityScore: "share" | "count";
  readonly periodVariance: "tracked" | "penalty";
};
export type HistoricalScoreManualOverride = {
  readonly cardName: string;
  readonly role?: "format_pillar" | "archetype_icon" | "flash_in_the_pan" | "role_player";
  readonly include?: boolean;
  readonly exclude?: boolean;
  readonly scoreAdjustment?: number;
  readonly reason?: string;
};

export type HistoricalPerSourcePolicy = {
  readonly allowArchiveDiscovery: boolean;
  readonly discoveryOptions: Readonly<Record<string, string>>;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
};

export type HistoricalModernConfig = {
  readonly project: {
    readonly name: string;
  };
  readonly historical: {
    readonly dateRange: HistoricalDateRange;
    readonly periodModel: HistoricalPeriodModel;
  };
  readonly sources: {
    readonly collectors: readonly HistoricalCollectorSource[];
    readonly enabledSources: readonly HistoricalCollectorSource[];
    readonly datePolicy: HistoricalDatePolicy;
    readonly unknownDateHandling: HistoricalCollectionDateHandling;
    readonly invalidDateHandling: HistoricalCollectionDateHandling;
    readonly outOfRangeHandling: HistoricalCollectionDateHandling;
    readonly allowArchiveDiscovery: boolean;
    readonly minimumDecksPerPeriod: number;
    readonly sourceCoverageManifestPath: string;
    readonly perSource: Readonly<Record<HistoricalCollectorSource, HistoricalPerSourcePolicy>>;
  };
  readonly setReleaseCalendar: {
    readonly path: string;
  };
  readonly coverage: {
    readonly minimumDecksPerPeriod: number;
    readonly minimumDecksPerSourcePeriod: number;
    readonly missingSourceWarningPolicy: HistoricalMissingSourceWarningPolicy;
  };
  readonly scoring: {
    readonly normalization: HistoricalScoringNormalizationConfig;
    readonly thresholds: {
      readonly eraShare: number;
      readonly pillarLongevity: number;
      readonly pillarPeak: number;
      readonly iconPeak: number;
      readonly flashPeak: number;
      readonly flashMaxLongevity: number;
    };
    readonly weights: {
      readonly glue: number;
      readonly longevity: number;
      readonly peak: number;
      readonly archetypeImportance: number;
      readonly periodVariancePenalty: number;
      readonly signpost: number;
      readonly parasitic: number;
    };
    readonly manualOverrides: readonly HistoricalScoreManualOverride[];
  };
  readonly archetypeReconstruction: {
    readonly coreShare: number;
    readonly supportShare: number;
    readonly signpostShare: number;
    readonly reconstructionThreshold: number;
  };
  readonly cubeGeneration: {
    readonly mode: "aggregate" | "historical";
    readonly totalCards: number;
    readonly minimumFormatPillars: number;
    readonly minimumArchetypeIcons: number;
    readonly minimumRepresentedPeriods: number;
  };
  readonly validation: {
    readonly minimumPeriodCoverage: number;
    readonly maximumPeriodCoverage: number;
    readonly minimumFormatPillars: number;
    readonly minimumArchetypeIcons: number;
    readonly maximumFlashInThePan: number;
    readonly minimumReconstructionScore: number;
    readonly minimumEcosystemDiversityScore: number;
  };
  readonly exports: {
    readonly outputDir: string;
    readonly historicalSourceCoverageCsv: string;
    readonly cardPeriodMatrixCsv: string;
    readonly archetypePeriodCoverageCsv: string;
    readonly historicalCardsRankedCsv: string;
    readonly formatPillarsCsv: string;
    readonly archetypeIconsCsv: string;
    readonly flashInPanReviewCsv: string;
    readonly cubeCsv: string;
    readonly archetypeReconstructionCsv: string;
    readonly eraCoverageCsv: string;
    readonly ecosystemDiversityCsv: string;
    readonly historicalValidationCsv: string;
    readonly historicalPeriodCoverageCsv: string;
    readonly historicalArchetypeReconstructionCsv: string;
  };
};

export type HistoricalConfigOverrides = {
  readonly dateRange?: Partial<HistoricalDateRange>;
  readonly outputDir?: string;
  readonly periodModel?: HistoricalPeriodModel;
};

export type LoadedHistoricalConfig = {
  readonly config: HistoricalModernConfig;
  readonly configHash: string;
};

export function loadHistoricalModernConfig(options: {
  readonly configPath?: string;
  readonly profileConfig?: unknown;
  readonly overrides?: HistoricalConfigOverrides;
} = {}): LoadedHistoricalConfig {
  const base = readJsonFile(defaultHistoricalModernConfigPath);
  const fileConfig = options.configPath ? readJsonFile(options.configPath) : {};
  const merged = mergeDeep(mergeDeep(base, options.profileConfig ?? {}), fileConfig);
  const withOverrides = applyHistoricalConfigOverrides(merged, options.overrides ?? {});
  const config = validateHistoricalModernConfig(withOverrides);
  return {
    config,
    configHash: historicalConfigHash(config)
  };
}

export function validateHistoricalModernConfig(value: unknown): HistoricalModernConfig {
  const config = requireRecord(value, "config");
  const project = requireRecord(config.project, "project");
  const historical = requireRecord(config.historical, "historical");
  const sources = requireRecord(config.sources, "sources");
  const coverage = requireRecord(config.coverage, "coverage");
  const setReleaseCalendar = requireRecord(config.setReleaseCalendar, "setReleaseCalendar");
  const scoring = requireRecord(config.scoring, "scoring");
  const normalization = requireRecord(scoring.normalization, "scoring.normalization");
  const thresholds = requireRecord(scoring.thresholds, "scoring.thresholds");
  const weights = requireRecord(scoring.weights, "scoring.weights");
  const archetypeReconstruction = requireRecord(config.archetypeReconstruction, "archetypeReconstruction");
  const cubeGeneration = requireRecord(config.cubeGeneration, "cubeGeneration");
  const validation = requireRecord(config.validation, "validation");
  const exportsConfig = requireRecord(config.exports, "exports");

  const periodModel = requireString(historical.periodModel, "historical.periodModel");
  if (periodModel !== "standard_set_release") {
    throw new Error(`Unsupported historical period model: ${periodModel}`);
  }

  const collectors = requireArray(sources.collectors, "sources.collectors").map((source) => {
    return requireCollectorSource(source, "sources.collectors[]");
  });
  const enabledSources = requireArray(sources.enabledSources ?? sources.collectors, "sources.enabledSources").map((source) => {
    return requireCollectorSource(source, "sources.enabledSources[]");
  });

  const datePolicy = requireString(sources.datePolicy, "sources.datePolicy");
  if (datePolicy !== "event_date_required") {
    throw new Error(`Unsupported historical date policy: ${datePolicy}`);
  }

  const mode = requireString(cubeGeneration.mode, "cubeGeneration.mode");
  if (mode !== "aggregate" && mode !== "historical") {
    throw new Error(`Unsupported cube generation mode: ${mode}`);
  }

  return {
    archetypeReconstruction: {
      coreShare: requireNumber(archetypeReconstruction.coreShare, "archetypeReconstruction.coreShare"),
      reconstructionThreshold: requireNumber(archetypeReconstruction.reconstructionThreshold, "archetypeReconstruction.reconstructionThreshold"),
      signpostShare: requireNumber(archetypeReconstruction.signpostShare, "archetypeReconstruction.signpostShare"),
      supportShare: requireNumber(archetypeReconstruction.supportShare, "archetypeReconstruction.supportShare")
    },
    coverage: {
      minimumDecksPerPeriod: requirePositiveInteger(coverage.minimumDecksPerPeriod, "coverage.minimumDecksPerPeriod"),
      minimumDecksPerSourcePeriod: requirePositiveInteger(coverage.minimumDecksPerSourcePeriod, "coverage.minimumDecksPerSourcePeriod"),
      missingSourceWarningPolicy: requireMissingSourceWarningPolicy(coverage.missingSourceWarningPolicy, "coverage.missingSourceWarningPolicy")
    },
    cubeGeneration: {
      minimumArchetypeIcons: requirePositiveInteger(cubeGeneration.minimumArchetypeIcons, "cubeGeneration.minimumArchetypeIcons"),
      minimumFormatPillars: requirePositiveInteger(cubeGeneration.minimumFormatPillars, "cubeGeneration.minimumFormatPillars"),
      minimumRepresentedPeriods: requirePositiveInteger(cubeGeneration.minimumRepresentedPeriods, "cubeGeneration.minimumRepresentedPeriods"),
      mode,
      totalCards: requirePositiveInteger(cubeGeneration.totalCards, "cubeGeneration.totalCards")
    },
    exports: {
      archetypeIconsCsv: requireString(exportsConfig.archetypeIconsCsv, "exports.archetypeIconsCsv"),
      archetypePeriodCoverageCsv: requireString(exportsConfig.archetypePeriodCoverageCsv, "exports.archetypePeriodCoverageCsv"),
      archetypeReconstructionCsv: requireString(exportsConfig.archetypeReconstructionCsv, "exports.archetypeReconstructionCsv"),
      cardPeriodMatrixCsv: requireString(exportsConfig.cardPeriodMatrixCsv, "exports.cardPeriodMatrixCsv"),
      cubeCsv: requireString(exportsConfig.cubeCsv, "exports.cubeCsv"),
      ecosystemDiversityCsv: requireString(exportsConfig.ecosystemDiversityCsv, "exports.ecosystemDiversityCsv"),
      eraCoverageCsv: requireString(exportsConfig.eraCoverageCsv, "exports.eraCoverageCsv"),
      flashInPanReviewCsv: requireString(exportsConfig.flashInPanReviewCsv, "exports.flashInPanReviewCsv"),
      formatPillarsCsv: requireString(exportsConfig.formatPillarsCsv, "exports.formatPillarsCsv"),
      historicalArchetypeReconstructionCsv: requireString(exportsConfig.historicalArchetypeReconstructionCsv, "exports.historicalArchetypeReconstructionCsv"),
      historicalCardsRankedCsv: requireString(exportsConfig.historicalCardsRankedCsv, "exports.historicalCardsRankedCsv"),
      historicalPeriodCoverageCsv: requireString(exportsConfig.historicalPeriodCoverageCsv, "exports.historicalPeriodCoverageCsv"),
      historicalSourceCoverageCsv: requireString(exportsConfig.historicalSourceCoverageCsv, "exports.historicalSourceCoverageCsv"),
      historicalValidationCsv: requireString(exportsConfig.historicalValidationCsv, "exports.historicalValidationCsv"),
      outputDir: requireString(exportsConfig.outputDir, "exports.outputDir")
    },
    historical: {
      dateRange: parseHistoricalDateRange(requireRecord(historical.dateRange, "historical.dateRange")),
      periodModel,
    },
    project: {
      name: requireString(project.name, "project.name")
    },
    scoring: {
      manualOverrides: requireManualOverrides(scoring.manualOverrides),
      normalization: {
        eraScore: requireStringUnion(normalization.eraScore, "scoring.normalization.eraScore", ["count", "share"]),
        longevityScore: requireStringUnion(normalization.longevityScore, "scoring.normalization.longevityScore", ["share", "count"]),
        peakScore: requireStringUnion(normalization.peakScore, "scoring.normalization.peakScore", ["raw", "sqrt"]),
        periodVariance: requireStringUnion(normalization.periodVariance, "scoring.normalization.periodVariance", ["tracked", "penalty"])
      },
      thresholds: {
        eraShare: requireNumber(thresholds.eraShare, "scoring.thresholds.eraShare"),
        flashMaxLongevity: requireNumber(thresholds.flashMaxLongevity, "scoring.thresholds.flashMaxLongevity"),
        flashPeak: requireNumber(thresholds.flashPeak, "scoring.thresholds.flashPeak"),
        iconPeak: requireNumber(thresholds.iconPeak, "scoring.thresholds.iconPeak"),
        pillarLongevity: requireNumber(thresholds.pillarLongevity, "scoring.thresholds.pillarLongevity"),
        pillarPeak: requireNumber(thresholds.pillarPeak, "scoring.thresholds.pillarPeak")
      },
      weights: {
        archetypeImportance: requireNumber(weights.archetypeImportance, "scoring.weights.archetypeImportance"),
        glue: requireNumber(weights.glue, "scoring.weights.glue"),
        longevity: requireNumber(weights.longevity, "scoring.weights.longevity"),
        parasitic: requireNumber(weights.parasitic, "scoring.weights.parasitic"),
        peak: requireNumber(weights.peak, "scoring.weights.peak"),
        periodVariancePenalty: requireNumber(weights.periodVariancePenalty, "scoring.weights.periodVariancePenalty"),
        signpost: requireNumber(weights.signpost, "scoring.weights.signpost")
      }
    },
    setReleaseCalendar: {
      path: requireString(setReleaseCalendar.path, "setReleaseCalendar.path")
    },
    sources: {
      allowArchiveDiscovery: requireBoolean(sources.allowArchiveDiscovery, "sources.allowArchiveDiscovery"),
      collectors,
      datePolicy,
      enabledSources,
      invalidDateHandling: requireCollectionDateHandling(sources.invalidDateHandling, "sources.invalidDateHandling"),
      minimumDecksPerPeriod: requirePositiveInteger(sources.minimumDecksPerPeriod, "sources.minimumDecksPerPeriod"),
      outOfRangeHandling: requireCollectionDateHandling(sources.outOfRangeHandling, "sources.outOfRangeHandling"),
      perSource: requirePerSourcePolicy(sources.perSource),
      unknownDateHandling: requireCollectionDateHandling(sources.unknownDateHandling, "sources.unknownDateHandling"),
      sourceCoverageManifestPath: requireString(sources.sourceCoverageManifestPath, "sources.sourceCoverageManifestPath")
    },
    validation: {
      maximumFlashInThePan: requirePositiveInteger(validation.maximumFlashInThePan, "validation.maximumFlashInThePan"),
      maximumPeriodCoverage: requirePositiveInteger(validation.maximumPeriodCoverage, "validation.maximumPeriodCoverage"),
      minimumArchetypeIcons: requirePositiveInteger(validation.minimumArchetypeIcons, "validation.minimumArchetypeIcons"),
      minimumEcosystemDiversityScore: requireNumber(validation.minimumEcosystemDiversityScore, "validation.minimumEcosystemDiversityScore"),
      minimumFormatPillars: requirePositiveInteger(validation.minimumFormatPillars, "validation.minimumFormatPillars"),
      minimumPeriodCoverage: requirePositiveInteger(validation.minimumPeriodCoverage, "validation.minimumPeriodCoverage"),
      minimumReconstructionScore: requireNumber(validation.minimumReconstructionScore, "validation.minimumReconstructionScore")
    }
  };
}

export function historicalConfigHash(config: HistoricalModernConfig): string {
  return createHash("sha256").update(stableStringify(config)).digest("hex");
}

function applyHistoricalConfigOverrides(config: unknown, overrides: HistoricalConfigOverrides): unknown {
  const overrideConfig: Record<string, unknown> = {};
  if (overrides.dateRange?.startDate || overrides.dateRange?.endDate || overrides.periodModel) {
    overrideConfig.historical = {
      ...(overrides.dateRange ? { dateRange: overrides.dateRange } : {}),
      ...(overrides.periodModel ? { periodModel: overrides.periodModel } : {})
    };
  }
  if (overrides.outputDir) {
    overrideConfig.exports = { outputDir: overrides.outputDir };
  }
  return mergeDeep(config, overrideConfig);
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Unable to load historical config ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function mergeDeep(left: unknown, right: unknown): unknown {
  if (!isRecord(left) || !isRecord(right)) {
    return right;
  }
  const merged: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    merged[key] = key in merged ? mergeDeep(merged[key], value) : value;
  }
  return merged;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Historical config ${name} must be an object.`);
  }
  return value;
}

function requireArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Historical config ${name} must be an array.`);
  }
  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Historical config ${name} must be a non-empty string.`);
  }
  return value;
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Historical config ${name} must be a boolean.`);
  }
  return value;
}

function requireCollectorSource(value: unknown, name: string): HistoricalCollectorSource {
  const source = requireString(value, name);
  if (source !== "mtgtop8" && source !== "mtgo" && source !== "mtggoldfish") {
    throw new Error(`Unknown historical collector source: ${source}`);
  }
  return source;
}

function requireCollectionDateHandling(value: unknown, name: string): HistoricalCollectionDateHandling {
  const handling = requireString(value, name);
  if (handling !== "discard" && handling !== "quarantine" && handling !== "persist_inactive") {
    throw new Error(`Unsupported historical collection date handling: ${handling}`);
  }
  return handling;
}

function requireMissingSourceWarningPolicy(value: unknown, name: string): HistoricalMissingSourceWarningPolicy {
  const policy = requireString(value, name);
  if (policy !== "ignore" && policy !== "warn" && policy !== "fail") {
    throw new Error(`Unsupported missing source warning policy: ${policy}`);
  }
  return policy;
}

function requireStringUnion<T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  const entry = requireString(value, name);
  if (!allowed.includes(entry as T)) {
    throw new Error(`Historical config ${name} must be one of: ${allowed.join(", ")}.`);
  }
  return entry as T;
}

function requireManualOverrides(value: unknown): readonly HistoricalScoreManualOverride[] {
  return requireArray(value, "scoring.manualOverrides").map((entry, index) => {
    const record = requireRecord(entry, `scoring.manualOverrides[${index}]`);
    const role = record.role === undefined ? undefined : requireStringUnion(record.role, `scoring.manualOverrides[${index}].role`, ["format_pillar", "archetype_icon", "flash_in_the_pan", "role_player"]);
    return {
      cardName: requireString(record.cardName, `scoring.manualOverrides[${index}].cardName`),
      exclude: record.exclude === undefined ? undefined : requireBoolean(record.exclude, `scoring.manualOverrides[${index}].exclude`),
      include: record.include === undefined ? undefined : requireBoolean(record.include, `scoring.manualOverrides[${index}].include`),
      reason: record.reason === undefined ? undefined : requireString(record.reason, `scoring.manualOverrides[${index}].reason`),
      role,
      scoreAdjustment: record.scoreAdjustment === undefined ? undefined : requireNumber(record.scoreAdjustment, `scoring.manualOverrides[${index}].scoreAdjustment`)
    };
  });
}

function requirePerSourcePolicy(value: unknown): Readonly<Record<HistoricalCollectorSource, HistoricalPerSourcePolicy>> {
  const record = requireRecord(value, "sources.perSource");
  return {
    mtggoldfish: requireSingleSourcePolicy(record.mtggoldfish, "sources.perSource.mtggoldfish"),
    mtgo: requireSingleSourcePolicy(record.mtgo, "sources.perSource.mtgo"),
    mtgtop8: requireSingleSourcePolicy(record.mtgtop8, "sources.perSource.mtgtop8")
  };
}

function requireSingleSourcePolicy(value: unknown, name: string): HistoricalPerSourcePolicy {
  const record = requireRecord(value, name);
  return {
    allowArchiveDiscovery: requireBoolean(record.allowArchiveDiscovery, `${name}.allowArchiveDiscovery`),
    discoveryOptions: requireStringRecord(record.discoveryOptions, `${name}.discoveryOptions`),
    exclude: requireStringArray(record.exclude, `${name}.exclude`),
    include: requireStringArray(record.include, `${name}.include`)
  };
}

function requireStringRecord(value: unknown, name: string): Readonly<Record<string, string>> {
  const record = requireRecord(value, name);
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, requireString(entry, `${name}.${key}`)]));
}

function requireStringArray(value: unknown, name: string): readonly string[] {
  return requireArray(value, name).map((entry) => requireString(entry, `${name}[]`));
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Historical config ${name} must be a number.`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, name: string): number {
  const number = requireNumber(value, name);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Historical config ${name} must be a positive integer.`);
  }
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
