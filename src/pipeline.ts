import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { generateCandidatePools, generateCube, validateCube, type GenerateCubeOptions, type ValidateCubeOptions } from "./build/index.js";
import type { CollectionDatePolicy, SourceCollectionPolicy } from "./collectors/index.js";
import { runCollectors } from "./collectors/index.js";
import { defaultProjectPaths } from "./config/paths.js";
import {
  applyMigrations,
  createPipelineRunId,
  openDatabase,
  registerOutputArtifact,
  upsertConfigProfile,
  upsertPipelineRun,
  upsertPipelineStageRun
} from "./db/index.js";
import { exportCubeCobra } from "./export/index.js";
import {
  dedupeDecks,
  fetchAndImportScryfallDefaultCards,
  importScryfallCardsFromFile,
  normalizeArchetypes,
  normalizeCards
} from "./normalize/index.js";
import { buildCardArchetypeMatrix, scoreCards } from "./scoring/index.js";
import type { DeckSource } from "./types/contracts.js";

export type RunFullPipelineOptions = {
  readonly databasePath?: string;
  readonly rawDataDir?: string;
  readonly outputDir?: string;
  readonly refresh?: boolean;
  readonly skipCollect?: boolean;
  readonly scryfallFile?: string;
  readonly fetchScryfall?: boolean;
  readonly pipelineRunId?: string;
  readonly cubeRunId?: string;
  readonly validationRunId?: string;
  readonly totalCards?: number;
  readonly collectorOptions?: Readonly<Record<string, string | undefined>>;
  readonly collectionDatePolicy?: Partial<CollectionDatePolicy>;
  readonly configHash?: string;
  readonly configProfileName?: string;
  readonly cubeGenerationOptions?: Partial<GenerateCubeOptions>;
  readonly effectiveConfig?: unknown;
  readonly exportOptions?: {
    readonly artifactMetadata?: unknown;
    readonly cubeCobraText?: boolean;
    readonly csv?: boolean;
    readonly registerArtifacts?: boolean;
  };
  readonly sourcePolicies?: Partial<Record<DeckSource, SourceCollectionPolicy>>;
  readonly sources?: readonly DeckSource[];
  readonly validationOptions?: Partial<ValidateCubeOptions>;
};

export type RunFullPipelineSummary = {
  readonly artifactPaths: readonly string[];
  readonly cubeRunId: string;
  readonly pipelineRunId: string;
  readonly validationRunId: string;
};

type StageResult = {
  readonly inputRefs?: unknown;
  readonly outputRefs?: unknown;
  readonly rowCount?: number;
};

export async function runFullPipeline(options: RunFullPipelineOptions = {}): Promise<RunFullPipelineSummary> {
  const databasePath = options.databasePath ?? defaultProjectPaths.sqliteDatabasePath;
  const rawDataDir = options.rawDataDir ?? defaultProjectPaths.rawDataDir;
  const outputDir = options.outputDir ?? defaultProjectPaths.outputsDir;
  const pipelineRunId = options.pipelineRunId ?? createPipelineRunId();
  const config = {
    collectorOptions: options.collectorOptions ?? {},
    fetchScryfall: options.fetchScryfall === true,
    outputDir,
    rawDataDir,
    refresh: options.refresh === true,
    skipCollect: options.skipCollect === true,
    scryfallFile: options.scryfallFile,
    totalCards: options.totalCards
  };
  const effectiveConfig = options.effectiveConfig ?? config;
  const configHash = options.configHash ?? stableConfigHash(effectiveConfig);
  const artifactPaths: string[] = [];

  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    upsertPipelineRun(database, {
      configHash,
      id: pipelineRunId,
      status: "running"
    });
    upsertConfigProfile(database, {
      config: effectiveConfig,
      configHash,
      name: "pipeline:latest"
    });
    if (options.configProfileName) {
      upsertConfigProfile(database, {
        config: effectiveConfig,
        configHash,
        name: options.configProfileName
      });
    }

    if (!options.skipCollect) {
      await runStage(database, pipelineRunId, "collect", configHash, {}, async () => {
        const summaries = await runCollectors({
          collectionDatePolicy: options.collectionDatePolicy,
          collectorOptions: options.collectorOptions,
          databasePath,
          rawDataDir,
          refresh: options.refresh,
          sourcePolicies: options.sourcePolicies,
          sources: options.sources
        });
        return {
          outputRefs: {
            snapshots: summaries.map((summary) => summary.parsedOutputPath),
            sources: summaries.map((summary) => summary.source)
          },
          rowCount: summaries.reduce((total, summary) => total + summary.deckCount, 0)
        };
      });
    }

    await runStage(database, pipelineRunId, "normalize:cards", configHash, {}, async () => {
      if (options.scryfallFile) {
        importScryfallCardsFromFile(database, options.scryfallFile);
      }
      if (options.fetchScryfall) {
        await fetchAndImportScryfallDefaultCards(database);
      }
      const summary = normalizeCards(database, {
        auditCsvPath: outputFile(outputDir, "card_name_audit.csv")
      });
      artifactPaths.push(...compact([summary.auditCsvPath]));
      return {
        outputRefs: summary,
        rowCount: summary.normalizedDecks
      };
    });

    await runStage(database, pipelineRunId, "normalize:archetypes", configHash, {}, () => {
      const summary = normalizeArchetypes(database, {
        auditCsvPath: outputFile(outputDir, "archetype_audit.csv")
      });
      artifactPaths.push(...compact([summary.auditCsvPath]));
      return {
        outputRefs: summary,
        rowCount: summary.normalizedDecks
      };
    });

    await runStage(database, pipelineRunId, "dedupe:decks", configHash, {}, () => {
      const summary = dedupeDecks(database, {
        reportCsvPath: outputFile(outputDir, "dedupe_report.csv")
      });
      artifactPaths.push(...compact([summary.reportCsvPath]));
      return {
        outputRefs: summary,
        rowCount: summary.weightedDecks
      };
    });

    const matrixSummary = await runStage(database, pipelineRunId, "matrix:build", configHash, {}, () => {
      const summary = buildCardArchetypeMatrix(database, {
        archetypeSummaryCsvPath: outputFile(outputDir, "archetypes_summary.csv"),
        matrixCsvPath: outputFile(outputDir, "card_archetype_matrix.csv"),
        pipelineRunId
      });
      artifactPaths.push(...compact([summary.matrixCsvPath, summary.archetypeSummaryCsvPath]));
      return {
        outputRefs: summary,
        rowCount: summary.matrixRows
      };
    });

    const scoreSummary = await runStage(database, pipelineRunId, "score:cards", configHash, { matrixSummary }, () => {
      const summary = scoreCards(database, {
        cardsRankedCsvPath: outputFile(outputDir, "cards_ranked.csv"),
        glueCardsCsvPath: outputFile(outputDir, "glue_cards.csv"),
        parasiticReviewCsvPath: outputFile(outputDir, "parasitic_review.csv"),
        pipelineRunId,
        signpostCandidatesCsvPath: outputFile(outputDir, "signpost_candidates.csv")
      });
      artifactPaths.push(...compact([summary.cardsRankedCsvPath, summary.glueCardsCsvPath, summary.parasiticReviewCsvPath, summary.signpostCandidatesCsvPath]));
      return {
        outputRefs: summary,
        rowCount: summary.scoreRows
      };
    });

    await runStage(database, pipelineRunId, "candidates:generate", configHash, { scoreSummary }, () => {
      const summary = generateCandidatePools(database, {
        outputDir,
        pipelineRunId
      });
      artifactPaths.push(...Object.values(summary.exportedCsvPaths).filter((filePath) => filePath.length > 0));
      return {
        outputRefs: summary,
        rowCount: summary.persistedRows
      };
    });

    const cubeSummary = await runStage(database, pipelineRunId, "cube:generate", configHash, {}, () => {
      const summary = generateCube(database, {
        ...options.cubeGenerationOptions,
        configHash,
        cubeRunId: options.cubeRunId,
        outputCsvPath: options.cubeGenerationOptions?.outputCsvPath ?? (options.exportOptions?.csv === false ? undefined : outputFile(outputDir, "cube_360_candidate.csv")),
        pipelineRunId,
        totalCards: options.totalCards ?? options.cubeGenerationOptions?.totalCards
      });
      artifactPaths.push(...compact([summary.outputCsvPath]));
      return {
        outputRefs: summary,
        rowCount: summary.selectedCards
      };
    });
    const cubeRunId = String(cubeSummary.outputRefsValue("cubeRunId"));

    const validationSummary = await runStage(database, pipelineRunId, "cube:validate", configHash, { cubeRunId }, () => {
      const summary = validateCube(database, {
        ...options.validationOptions,
        configHash,
        cubeRunId,
        outputCsvPath: options.validationOptions?.outputCsvPath ?? (options.exportOptions?.csv === false ? undefined : outputFile(outputDir, "cube_validation_report.csv")),
        validationRunId: options.validationRunId
      });
      artifactPaths.push(...compact([summary.outputCsvPath]));
      return {
        outputRefs: summary,
        rowCount: summary.metrics + summary.warnings + summary.zeroSupportCards
      };
    });
    const validationRunId = String(validationSummary.outputRefsValue("validationRunId"));

    if (options.exportOptions?.cubeCobraText !== false) {
      await runStage(database, pipelineRunId, "export:cube-cobra", configHash, { cubeRunId }, () => {
        const summary = exportCubeCobra(database, {
          cubeRunId,
          outputPath: outputFile(outputDir, "cube_cobra_import.txt")
        });
        artifactPaths.push(summary.outputPath);
        return {
          outputRefs: summary,
          rowCount: summary.cards
        };
      });
    }

    const uniqueArtifactPaths = [...new Set(artifactPaths)];
    if (options.exportOptions?.registerArtifacts !== false) {
      for (const filePath of uniqueArtifactPaths) {
        registerArtifact(database, pipelineRunId, filePath, configHash, options.exportOptions?.artifactMetadata);
      }
    }

    upsertPipelineRun(database, {
      completedAt: new Date().toISOString(),
      configHash,
      id: pipelineRunId,
      status: "completed"
    });

    return {
      artifactPaths: uniqueArtifactPaths,
      cubeRunId,
      pipelineRunId,
      validationRunId
    };
  } catch (error) {
    upsertPipelineRun(database, {
      completedAt: new Date().toISOString(),
      configHash,
      id: pipelineRunId,
      status: "failed"
    });
    throw error;
  } finally {
    database.close();
  }
}

async function runStage(
  database: DatabaseSync,
  pipelineRunId: string,
  stage: string,
  configHash: string,
  inputRefs: unknown,
  action: () => StageResult | Promise<StageResult>
): Promise<StageResult & { readonly outputRefsValue: (key: string) => unknown }> {
  const startedAt = new Date().toISOString();
  upsertPipelineStageRun(database, {
    configHash,
    inputRefs,
    pipelineRunId,
    stage,
    startedAt,
    status: "running"
  });

  try {
    const result = await action();
    upsertPipelineStageRun(database, {
      completedAt: new Date().toISOString(),
      configHash,
      inputRefs: result.inputRefs ?? inputRefs,
      outputRefs: result.outputRefs ?? {},
      pipelineRunId,
      rowCount: result.rowCount,
      stage,
      startedAt,
      status: "completed"
    });

    return {
      ...result,
      outputRefsValue: (key) => readObjectValue(result.outputRefs, key)
    };
  } catch (error) {
    upsertPipelineStageRun(database, {
      completedAt: new Date().toISOString(),
      configHash,
      error: error instanceof Error ? { message: error.message, name: error.name } : { message: String(error) },
      inputRefs,
      pipelineRunId,
      stage,
      startedAt,
      status: "failed"
    });
    throw error;
  }
}

function registerArtifact(database: DatabaseSync, pipelineRunId: string, filePath: string, configHash?: string, artifactMetadata?: unknown): void {
  if (!existsSync(filePath)) {
    return;
  }

  registerOutputArtifact(database, {
    contentHash: contentHashForFile(filePath),
    format: path.extname(filePath).replace(/^\./, "") || "text",
    path: filePath,
    pipelineRunId,
    sourceMetadata: { artifactMetadata, configHash, generatedBy: "pipeline:run" },
    stage: stageForArtifact(filePath)
  });
}

function stageForArtifact(filePath: string): string {
  const basename = path.basename(filePath);
  const candidateOutputs = new Set([
    "auto_includes.csv",
    "glue_cards.csv",
    "signpost_cards.csv",
    "parasitic_review.csv",
    "sideboard_cards.csv",
    "lands.csv",
    "removal.csv",
    "threats.csv"
  ]);
  if (basename.includes("cube_cobra")) return "export:cube-cobra";
  if (basename.includes("validation")) return "cube:validate";
  if (basename.includes("cube_360")) return "cube:generate";
  if (candidateOutputs.has(basename)) return "candidates:generate";
  if (basename.includes("score") || basename.includes("ranked") || basename.includes("signpost_candidates")) return "score:cards";
  if (basename.includes("matrix") || basename.includes("archetypes_summary")) return "matrix:build";
  if (basename.includes("dedupe")) return "dedupe:decks";
  if (basename.includes("archetype_audit")) return "normalize:archetypes";
  return "normalize:cards";
}

function outputFile(outputDir: string, filename: string): string {
  return path.join(outputDir, filename);
}

function contentHashForFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function stableConfigHash(config: unknown): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

function compact<T>(values: readonly (T | undefined)[]): readonly T[] {
  return values.filter((value): value is T => value !== undefined);
}

function readObjectValue(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" && key in value ? (value as Record<string, unknown>)[key] : undefined;
}
