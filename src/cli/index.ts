#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { evaluateCubeReconstruction, generateCandidatePools, generateCube, validateCube } from "../build/index.js";
import { runCollectors } from "../collectors/index.js";
import { defaultProjectPaths } from "../config/paths.js";
import {
  defaultHistoricalCoverageCsvPath,
  defaultMinimumDecksPerPeriod,
  defaultSourceCoverageManifestPath,
  generateHistoricalCoverageReport
} from "../coverage.js";
import {
  applyMigrations,
  getDatabaseStatus,
  listConfigProfiles,
  listMetagamePeriods,
  listManualReviewItems,
  listOutputArtifacts,
  openDatabase,
  runIntegrityCheck
} from "../db/index.js";
import {
  dedupeDecks,
  fetchAndImportScryfallDefaultCards,
  importScryfallCardsFromFile,
  normalizeArchetypes,
  normalizeCards
} from "../normalize/index.js";
import { runFullPipeline } from "../pipeline.js";
import {
  assignDecksToMetagamePeriods,
  defaultHistoricalEndDate,
  defaultHistoricalStartDate,
  defaultSetReleaseCalendarPath,
  generateAndPersistMetagamePeriods,
  parseMetagamePeriodModel,
  seedSetReleases
} from "../periods.js";
import { buildCardArchetypeMatrix, buildPeriodMatrices, scoreCards, scoreHistoricalCards } from "../scoring/index.js";
import type { DeckSource } from "../types/contracts.js";

const args = process.argv.slice(2);
if (args[0] === "--") {
  args.shift();
}

const [command = "help"] = args;
const databasePath = getOptionValue("--db") ?? defaultProjectPaths.sqliteDatabasePath;
const rawDataDir = getOptionValue("--raw-dir") ?? defaultProjectPaths.rawDataDir;
const refresh = args.includes("--refresh");

if (command === "help" || command === "--help" || command === "-h") {
  console.log(`cube-refiner

Usage:
  cube-refiner help
  cube-refiner pipeline:run [--db path] [--raw-dir path] [--output-dir path] [--skip-collect] [--scryfall-file path] [--fetch-scryfall] [--pipeline-run-id id] [--cube-run-id id]
  cube-refiner db:init [--db path]
  cube-refiner db:migrate [--db path]
  cube-refiner db:status [--db path] [--json]
  cube-refiner db:reviews [--db path] [--queue name] [--json]
  cube-refiner db:artifacts [--db path] [--pipeline-run-id id] [--json]
  cube-refiner db:configs [--db path] [--json]
  cube-refiner db:backup [--db path] [--output path]
  cube-refiner db:check [--db path] [--json]
  cube-refiner db:vacuum [--db path]
  cube-refiner db:reset [--db path] --force [--backup path]
  cube-refiner collect:all [--db path] [--raw-dir path] [--refresh]
  cube-refiner collect:mtgtop8 [--db path] [--raw-dir path] [--refresh]
  cube-refiner collect:mtgo [--db path] [--raw-dir path] [--refresh]
  cube-refiner collect:mtggoldfish [--db path] [--raw-dir path] [--refresh] [--events ids-or-urls]
  cube-refiner normalize:cards [--db path] [--scryfall-file path] [--fetch-scryfall] [--audit-csv path] [--fail-on-unknown]
  cube-refiner normalize:archetypes [--db path] [--mapping-file path] [--audit-csv path] [--fail-on-unmapped]
  cube-refiner dedupe:decks [--db path] [--report-csv path] [--near-overlap count]
  cube-refiner periods:seed [--db path] [--set-releases-file path]
  cube-refiner periods:generate [--db path] [--set-releases-file path] [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] [--model standard-set-release]
  cube-refiner periods:list [--db path] [--json]
  cube-refiner periods:assign [--db path]
  cube-refiner coverage:historical [--db path] [--output-csv path] [--source-manifest path] [--min-decks n] [--pipeline-run-id id]
  cube-refiner matrix:build [--db path] [--matrix-csv path] [--archetypes-csv path] [--pipeline-run-id id]
  cube-refiner matrix:periods [--db path] [--card-period-csv path] [--archetype-period-csv path] [--pipeline-run-id id]
  cube-refiner score:cards [--db path] --pipeline-run-id id [--glue-threshold n] [--signpost-affinity n] [--signpost-exclusivity n] [--signpost-min-decks n]
  cube-refiner score:historical [--db path] --pipeline-run-id id [--aggregate-pipeline-run-id id] [--era-share n] [--pillar-longevity n] [--pillar-peak n] [--icon-peak n] [--flash-peak n] [--flash-max-longevity n] [--weight-glue n] [--weight-longevity n] [--weight-peak n] [--weight-archetype n]
  cube-refiner candidates:generate [--db path] --pipeline-run-id id [--output-dir path]
  cube-refiner cube:generate [--db path] --pipeline-run-id id [--cube-run-id id] [--output-csv path] [--mode aggregate|historical] [--min-format-pillars n] [--min-archetype-icons n] [--min-periods n]
  cube-refiner cube:reconstruct [--db path] --cube-run-id id --pipeline-run-id id [--reconstruction-csv path] [--era-coverage-csv path] [--ecosystem-csv path]
  cube-refiner cube:validate [--db path] --cube-run-id id [--validation-run-id id] [--output-csv path]

Project paths:
  raw data:        ${defaultProjectPaths.rawDataDir}
  normalized data: ${defaultProjectPaths.normalizedDataDir}
  outputs:         ${defaultProjectPaths.outputsDir}
  sqlite db:       ${defaultProjectPaths.sqliteDatabasePath}
`);
  process.exit(0);
}

if (command === "pipeline:run") {
  const summary = await runFullPipeline({
    collectorOptions: {
      limitDecks: getOptionValue("--limit-decks"),
      limitEvents: getOptionValue("--limit-events"),
      events: getOptionValue("--events"),
      months: getOptionValue("--months"),
      years: getOptionValue("--years")
    },
    databasePath,
    fetchScryfall: args.includes("--fetch-scryfall"),
    outputDir: getOptionValue("--output-dir") ?? defaultProjectPaths.outputsDir,
    pipelineRunId: getOptionValue("--pipeline-run-id"),
    rawDataDir,
    refresh,
    scryfallFile: getOptionValue("--scryfall-file"),
    skipCollect: args.includes("--skip-collect"),
    totalCards: parsePositiveInteger(getOptionValue("--total-cards")),
    cubeRunId: getOptionValue("--cube-run-id"),
    validationRunId: getOptionValue("--validation-run-id")
  });

  console.log(`Pipeline run ${summary.pipelineRunId} completed.`);
  console.log(`Cube run: ${summary.cubeRunId}`);
  console.log(`Validation run: ${summary.validationRunId}`);
  for (const artifactPath of summary.artifactPaths) {
    console.log(`Artifact: ${artifactPath}`);
  }
  process.exit(0);
}

if (command.startsWith("collect:")) {
  const sources = collectorSourcesForCommand(command);
  if (!sources) {
    console.error(`Unknown collector command: ${command}`);
    process.exit(1);
  }

  const summaries = await runCollectors({
    collectorOptions: {
      limitDecks: getOptionValue("--limit-decks"),
      limitEvents: getOptionValue("--limit-events"),
      events: getOptionValue("--events"),
      months: getOptionValue("--months"),
      years: getOptionValue("--years")
    },
    databasePath,
    rawDataDir,
    refresh,
    sources
  });

  for (const summary of summaries) {
    console.log(
      `${summary.source}: ${summary.deckCount} decklists persisted; parsed snapshot: ${summary.parsedOutputPath}`
    );
  }

  process.exit(0);
}

if (command === "normalize:cards") {
  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);

    const scryfallFile = getOptionValue("--scryfall-file");
    if (scryfallFile) {
      const imported = importScryfallCardsFromFile(database, scryfallFile);
      console.log(`Imported ${imported} canonical cards from ${scryfallFile}.`);
    }

    if (args.includes("--fetch-scryfall")) {
      const imported = await fetchAndImportScryfallDefaultCards(database);
      console.log(`Imported ${imported} canonical cards from Scryfall default-cards bulk data.`);
    }

    const summary = normalizeCards(database, {
      auditCsvPath: getOptionValue("--audit-csv") ?? `${defaultProjectPaths.outputsDir}/card_name_audit.csv`,
      failOnUnknown: args.includes("--fail-on-unknown")
    });
    console.log(
      `Normalized ${summary.normalizedDecks} decks; mapped ${summary.mappedNames} raw names; unresolved ${summary.unresolvedNames}.`
    );
    if (summary.auditCsvPath) {
      console.log(`Audit CSV: ${summary.auditCsvPath}`);
    }
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "normalize:archetypes") {
  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const summary = normalizeArchetypes(database, {
      auditCsvPath: getOptionValue("--audit-csv") ?? `${defaultProjectPaths.outputsDir}/archetype_audit.csv`,
      failOnUnmapped: args.includes("--fail-on-unmapped"),
      mappingFilePath: getOptionValue("--mapping-file")
    });
    console.log(
      `Normalized archetypes on ${summary.normalizedDecks} decks; mapped ${summary.mappedLabels} labels; ` +
        `unmapped ${summary.unmappedLabels}; ambiguous ${summary.ambiguousLabels}.`
    );
    if (summary.auditCsvPath) {
      console.log(`Audit CSV: ${summary.auditCsvPath}`);
    }
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "dedupe:decks") {
  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const summary = dedupeDecks(database, {
      nearOverlapThreshold: parsePositiveInteger(getOptionValue("--near-overlap")),
      reportCsvPath: getOptionValue("--report-csv") ?? `${defaultProjectPaths.outputsDir}/dedupe_report.csv`
    });
    console.log(
      `Weighted ${summary.weightedDecks} decks; exact clusters ${summary.exactClusters}; near clusters ${summary.nearClusters}.`
    );
    if (summary.reportCsvPath) {
      console.log(`Dedupe report CSV: ${summary.reportCsvPath}`);
    }
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "periods:seed") {
  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const setReleasesFile = getOptionValue("--set-releases-file") ?? defaultSetReleaseCalendarPath;
    const seeded = seedSetReleases(database, { setReleasesFile });
    console.log(`Seeded ${seeded} Standard set releases from ${setReleasesFile}.`);
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "periods:generate") {
  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const setReleasesFile = getOptionValue("--set-releases-file") ?? defaultSetReleaseCalendarPath;
    const seeded = seedSetReleases(database, { setReleasesFile });
    const summary = generateAndPersistMetagamePeriods(database, {
      endDate: getOptionValue("--end-date") ?? defaultHistoricalEndDate,
      model: parseMetagamePeriodModel(getOptionValue("--model")),
      startDate: getOptionValue("--start-date") ?? defaultHistoricalStartDate
    });
    console.log(`Seeded ${seeded} Standard set releases from ${setReleasesFile}.`);
    console.log(
      `Generated ${summary.periods} ${summary.model} periods from ${summary.startDate} through ${summary.endDate}.`
    );
    console.log(`Config hash: ${summary.configHash}`);
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "periods:list") {
  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const periods = listMetagamePeriods(database);
    if (args.includes("--json")) {
      console.log(JSON.stringify(periods, null, 2));
    } else {
      for (const period of periods) {
        console.log(`${period.sortOrder}: ${period.periodId} ${period.startDate}..${period.endDate} (${period.setName})`);
      }
    }
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "periods:assign") {
  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const summary = assignDecksToMetagamePeriods(database);
    console.log(`Assigned ${summary.assignedDecks} decks to metagame periods; review rows ${summary.reviewRows}.`);
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "coverage:historical") {
  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const summary = generateHistoricalCoverageReport(database, {
      minimumDecksPerPeriod: parsePositiveInteger(getOptionValue("--min-decks")) ?? defaultMinimumDecksPerPeriod,
      outputCsvPath: getOptionValue("--output-csv") ?? defaultHistoricalCoverageCsvPath,
      pipelineRunId: getOptionValue("--pipeline-run-id"),
      sourceManifestPath: getOptionValue("--source-manifest") ?? defaultSourceCoverageManifestPath
    });
    console.log(
      `Generated historical source coverage for run ${summary.pipelineRunId}: ${summary.rows} rows, ${summary.warnings} warnings.`
    );
    console.log(
      `Period assignments refreshed: ${summary.assignedDecks} assigned, ${summary.assignmentReviewRows} review rows.`
    );
    if (summary.outputCsvPath) {
      console.log(`Coverage CSV: ${summary.outputCsvPath}`);
    }
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "matrix:build") {
  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const summary = buildCardArchetypeMatrix(database, {
      archetypeSummaryCsvPath: getOptionValue("--archetypes-csv") ?? `${defaultProjectPaths.outputsDir}/archetypes_summary.csv`,
      matrixCsvPath: getOptionValue("--matrix-csv") ?? `${defaultProjectPaths.outputsDir}/card_archetype_matrix.csv`,
      pipelineRunId: getOptionValue("--pipeline-run-id")
    });
    console.log(
      `Built ${summary.matrixRows} matrix rows and ${summary.archetypeSummaryRows} archetype summaries for run ${summary.pipelineRunId}.`
    );
    if (summary.matrixCsvPath) {
      console.log(`Matrix CSV: ${summary.matrixCsvPath}`);
    }
    if (summary.archetypeSummaryCsvPath) {
      console.log(`Archetype summary CSV: ${summary.archetypeSummaryCsvPath}`);
    }
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "matrix:periods") {
  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const summary = buildPeriodMatrices(database, {
      archetypePeriodCoverageCsvPath: getOptionValue("--archetype-period-csv") ?? `${defaultProjectPaths.outputsDir}/archetype_period_coverage.csv`,
      cardPeriodMatrixCsvPath: getOptionValue("--card-period-csv") ?? `${defaultProjectPaths.outputsDir}/card_period_matrix.csv`,
      pipelineRunId: getOptionValue("--pipeline-run-id")
    });
    console.log(
      `Built ${summary.cardRows} card/period rows and ${summary.archetypeRows} archetype/period rows for run ${summary.pipelineRunId}.`
    );
    if (summary.cardPeriodMatrixCsvPath) {
      console.log(`Card period matrix CSV: ${summary.cardPeriodMatrixCsvPath}`);
    }
    if (summary.archetypePeriodCoverageCsvPath) {
      console.log(`Archetype period coverage CSV: ${summary.archetypePeriodCoverageCsvPath}`);
    }
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "score:cards") {
  const pipelineRunId = getOptionValue("--pipeline-run-id");
  if (!pipelineRunId) {
    console.error("score:cards requires --pipeline-run-id.");
    process.exit(1);
  }

  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const summary = scoreCards(database, {
      cardsRankedCsvPath: getOptionValue("--cards-ranked-csv") ?? `${defaultProjectPaths.outputsDir}/cards_ranked.csv`,
      glueAffinityThreshold: parseNumberOption(getOptionValue("--glue-threshold")),
      glueCardsCsvPath: getOptionValue("--glue-cards-csv") ?? `${defaultProjectPaths.outputsDir}/glue_cards.csv`,
      parasiticReviewCsvPath: getOptionValue("--parasitic-review-csv") ?? `${defaultProjectPaths.outputsDir}/parasitic_review.csv`,
      pipelineRunId,
      signpostAffinityThreshold: parseNumberOption(getOptionValue("--signpost-affinity")),
      signpostCandidatesCsvPath: getOptionValue("--signpost-candidates-csv") ?? `${defaultProjectPaths.outputsDir}/signpost_candidates.csv`,
      signpostExclusivityThreshold: parseNumberOption(getOptionValue("--signpost-exclusivity")),
      signpostMinDecksWithCard: parsePositiveInteger(getOptionValue("--signpost-min-decks"))
    });
    console.log(`Scored ${summary.scoreRows} cards for run ${summary.pipelineRunId}.`);
    console.log(`Cards ranked CSV: ${summary.cardsRankedCsvPath}`);
    console.log(`Signpost candidates CSV: ${summary.signpostCandidatesCsvPath}`);
    console.log(`Glue cards CSV: ${summary.glueCardsCsvPath}`);
    console.log(`Parasitic review CSV: ${summary.parasiticReviewCsvPath}`);
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "score:historical") {
  const pipelineRunId = getOptionValue("--pipeline-run-id");
  if (!pipelineRunId) {
    console.error("score:historical requires --pipeline-run-id.");
    process.exit(1);
  }

  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const summary = scoreHistoricalCards(database, {
      aggregatePipelineRunId: getOptionValue("--aggregate-pipeline-run-id"),
      archetypeIconsCsvPath: getOptionValue("--archetype-icons-csv") ?? `${defaultProjectPaths.outputsDir}/archetype_icons.csv`,
      flashInPanReviewCsvPath: getOptionValue("--flash-review-csv") ?? `${defaultProjectPaths.outputsDir}/flash_in_pan_review.csv`,
      formatPillarsCsvPath: getOptionValue("--format-pillars-csv") ?? `${defaultProjectPaths.outputsDir}/format_pillars.csv`,
      historicalCardsRankedCsvPath: getOptionValue("--historical-cards-ranked-csv") ?? `${defaultProjectPaths.outputsDir}/historical_cards_ranked.csv`,
      pipelineRunId,
      thresholds: {
        eraShare: parseNumberOption(getOptionValue("--era-share")) ?? 0.05,
        flashMaxLongevity: parseNumberOption(getOptionValue("--flash-max-longevity")) ?? 0.25,
        flashPeak: parseNumberOption(getOptionValue("--flash-peak")) ?? 0.25,
        iconPeak: parseNumberOption(getOptionValue("--icon-peak")) ?? 0.18,
        pillarLongevity: parseNumberOption(getOptionValue("--pillar-longevity")) ?? 0.5,
        pillarPeak: parseNumberOption(getOptionValue("--pillar-peak")) ?? 0.08
      },
      weights: {
        archetypeImportance: parseNumberOption(getOptionValue("--weight-archetype")) ?? 0.15,
        glue: parseNumberOption(getOptionValue("--weight-glue")) ?? 0.2,
        longevity: parseNumberOption(getOptionValue("--weight-longevity")) ?? 0.35,
        peak: parseNumberOption(getOptionValue("--weight-peak")) ?? 0.3
      }
    });
    console.log(`Scored ${summary.scoreRows} historical cards for run ${summary.pipelineRunId}.`);
    console.log(`Historical cards ranked CSV: ${summary.historicalCardsRankedCsvPath}`);
    console.log(`Format pillars CSV: ${summary.formatPillarsCsvPath}`);
    console.log(`Archetype icons CSV: ${summary.archetypeIconsCsvPath}`);
    console.log(`Flash review CSV: ${summary.flashInPanReviewCsvPath}`);
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "candidates:generate") {
  const pipelineRunId = getOptionValue("--pipeline-run-id");
  if (!pipelineRunId) {
    console.error("candidates:generate requires --pipeline-run-id.");
    process.exit(1);
  }

  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const summary = generateCandidatePools(database, {
      autoIncludeMinCubeScore: parseNumberOption(getOptionValue("--auto-include-min-cube-score")),
      glueMinScore: parseNumberOption(getOptionValue("--glue-min-score")),
      outputDir: getOptionValue("--output-dir") ?? defaultProjectPaths.outputsDir,
      parasiticMinScore: parseNumberOption(getOptionValue("--parasitic-min-score")),
      pipelineRunId,
      sideboardOnlyMinShare: parseNumberOption(getOptionValue("--sideboard-only-min-share")),
      signpostMinScore: parseNumberOption(getOptionValue("--signpost-min-score"))
    });
    console.log(`Persisted ${summary.persistedRows} candidate pool rows for run ${summary.pipelineRunId}.`);
    for (const [pool, filePath] of Object.entries(summary.exportedCsvPaths)) {
      console.log(`${pool}: ${filePath}`);
    }
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "cube:generate") {
  const pipelineRunId = getOptionValue("--pipeline-run-id");
  if (!pipelineRunId) {
    console.error("cube:generate requires --pipeline-run-id.");
    process.exit(1);
  }

  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const summary = generateCube(database, {
      cubeRunId: getOptionValue("--cube-run-id"),
      minimumArchetypeIcons: parsePositiveInteger(getOptionValue("--min-archetype-icons")),
      minimumFormatPillars: parsePositiveInteger(getOptionValue("--min-format-pillars")),
      minimumRepresentedPeriods: parsePositiveInteger(getOptionValue("--min-periods")),
      mode: parseCubeMode(getOptionValue("--mode")),
      outputCsvPath: getOptionValue("--output-csv") ?? `${defaultProjectPaths.outputsDir}/cube_360_candidate.csv`,
      pipelineRunId,
      totalCards: parsePositiveInteger(getOptionValue("--total-cards"))
    });
    console.log(`Generated cube ${summary.cubeRunId} with ${summary.selectedCards} cards.`);
    if (summary.outputCsvPath) {
      console.log(`Cube CSV: ${summary.outputCsvPath}`);
    }
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "cube:reconstruct") {
  const cubeRunId = getOptionValue("--cube-run-id");
  const pipelineRunId = getOptionValue("--pipeline-run-id");
  if (!cubeRunId || !pipelineRunId) {
    console.error("cube:reconstruct requires --cube-run-id and --pipeline-run-id.");
    process.exit(1);
  }

  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const summary = evaluateCubeReconstruction(database, {
      archetypeReconstructionCsvPath: getOptionValue("--reconstruction-csv") ?? `${defaultProjectPaths.outputsDir}/archetype_reconstruction.csv`,
      coreShare: parseNumberOption(getOptionValue("--core-share")),
      cubeRunId,
      ecosystemDiversityCsvPath: getOptionValue("--ecosystem-csv") ?? `${defaultProjectPaths.outputsDir}/ecosystem_diversity_report.csv`,
      eraCoverageCsvPath: getOptionValue("--era-coverage-csv") ?? `${defaultProjectPaths.outputsDir}/era_coverage.csv`,
      pipelineRunId,
      reconstructionThreshold: parseNumberOption(getOptionValue("--reconstruction-threshold")),
      signpostShare: parseNumberOption(getOptionValue("--signpost-share")),
      supportShare: parseNumberOption(getOptionValue("--support-share"))
    });
    console.log(
      `Evaluated cube ${summary.cubeRunId}: ${summary.reconstructionRows} archetype/period rows, ${summary.targets} targets.`
    );
    console.log(
      `Ecosystem: ${summary.archetypesAboveThreshold} archetypes above threshold, ${summary.periodsRepresented} periods represented, shared efficiency ${summary.sharedCardEfficiency.toFixed(3)}.`
    );
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "cube:validate") {
  const cubeRunId = getOptionValue("--cube-run-id");
  if (!cubeRunId) {
    console.error("cube:validate requires --cube-run-id.");
    process.exit(1);
  }

  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const summary = validateCube(database, {
      cubeRunId,
      maximumSupportPerArchetype: parsePositiveInteger(getOptionValue("--max-support-per-archetype")),
      maximumZeroSupportCards: parsePositiveInteger(getOptionValue("--max-zero-support-cards")),
      minimumArchetypeSupport: parsePositiveInteger(getOptionValue("--min-archetype-support")),
      minimumFixing: parsePositiveInteger(getOptionValue("--min-fixing")),
      minimumOneDrops: parsePositiveInteger(getOptionValue("--min-one-drops")),
      minimumRemoval: parsePositiveInteger(getOptionValue("--min-removal")),
      minimumSupportPerArchetype: parsePositiveInteger(getOptionValue("--min-support-per-archetype")),
      outputCsvPath: getOptionValue("--output-csv") ?? `${defaultProjectPaths.outputsDir}/cube_validation_report.csv`,
      targetTolerance: parsePositiveInteger(getOptionValue("--target-tolerance")),
      validationRunId: getOptionValue("--validation-run-id")
    });
    console.log(
      `Validated cube ${cubeRunId} as ${summary.status}; metrics ${summary.metrics}; warnings ${summary.warnings}; zero-support cards ${summary.zeroSupportCards}.`
    );
    if (summary.outputCsvPath) {
      console.log(`Validation CSV: ${summary.outputCsvPath}`);
    }
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "db:init" || command === "db:migrate") {
  const database = openDatabase({ path: databasePath });
  try {
    const applied = applyMigrations(database);
    const summary = applied.length === 0 ? "No migrations to apply." : `Applied migrations: ${applied.join(", ")}`;
    console.log(`${summary}\nDatabase: ${databasePath}`);
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "db:status") {
  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const status = getDatabaseStatus(database);
    if (args.includes("--json")) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(`Database: ${databasePath}`);
      console.log(`Migrations: ${status.schemaMigrations.join(", ") || "none"}`);
      console.log(`Ready for pipeline: ${status.readyForPipeline ? "yes" : "no"}`);
      console.log(`Pending review items: ${status.pendingReviewItems}`);
      console.log(`Output artifacts: ${status.outputArtifacts} (${status.staleArtifacts} stale)`);
      console.log(`Config profiles: ${status.configProfiles}`);
      if (status.latestPipelineRun) {
        console.log(`Latest run: ${status.latestPipelineRun.id} (${status.latestPipelineRun.status})`);
        for (const stage of status.latestPipelineStages) {
          console.log(`  ${stage.stage}: ${stage.status}, rows=${stage.rowCount}`);
        }
      }
      for (const [table, count] of Object.entries(status.counts)) {
        console.log(`${table}: ${count}`);
      }
    }
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "db:reviews") {
  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const items = listManualReviewItems(database, parseReviewQueue(getOptionValue("--queue")));
    if (args.includes("--json")) {
      console.log(JSON.stringify(items, null, 2));
    } else {
      if (items.length === 0) {
        console.log("No pending manual review items.");
      }
      for (const item of items) {
        console.log(`${item.queue}: ${item.item} - ${item.detail}`);
      }
    }
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "db:artifacts") {
  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const artifacts = listOutputArtifacts(database, getOptionValue("--pipeline-run-id"));
    if (args.includes("--json")) {
      console.log(JSON.stringify(artifacts, null, 2));
    } else {
      for (const artifact of artifacts) {
        console.log(`${artifact.stage}: ${artifact.path} ${artifact.existsOnDisk ? "" : "(missing)"}`.trim());
      }
    }
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "db:configs") {
  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const profiles = listConfigProfiles(database);
    if (args.includes("--json")) {
      console.log(JSON.stringify(profiles, null, 2));
    } else {
      for (const profile of profiles) {
        console.log(`${profile.name}: ${profile.configHash} updated=${profile.updatedAt}`);
      }
    }
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "db:backup") {
  const outputPath = getOptionValue("--output") ?? defaultBackupPath(databasePath);
  backupDatabaseFiles(databasePath, outputPath);
  console.log(`Database backup: ${outputPath}`);
  process.exit(0);
}

if (command === "db:check") {
  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    const results = runIntegrityCheck(database);
    if (args.includes("--json")) {
      console.log(JSON.stringify({ results }, null, 2));
    } else {
      console.log(results.join("\n"));
    }
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "db:vacuum") {
  const database = openDatabase({ path: databasePath });
  try {
    applyMigrations(database);
    database.exec("VACUUM;");
    console.log(`Vacuumed database: ${databasePath}`);
  } finally {
    database.close();
  }
  process.exit(0);
}

if (command === "db:reset") {
  if (databasePath === ":memory:") {
    console.error("db:reset requires a file-backed database path.");
    process.exit(1);
  }
  if (!args.includes("--force")) {
    console.error("db:reset is destructive; rerun with --force or create a backup first with db:backup.");
    process.exit(1);
  }

  const backupPath = getOptionValue("--backup");
  if (backupPath) {
    backupDatabaseFiles(databasePath, backupPath);
    console.log(`Database backup: ${backupPath}`);
  }

  if (existsSync(databasePath)) {
    rmSync(databasePath);
  }

  for (const suffix of ["-shm", "-wal"]) {
    const sidecar = `${databasePath}${suffix}`;
    if (existsSync(sidecar)) {
      rmSync(sidecar);
    }
  }

  const database = openDatabase({ path: databasePath });
  try {
    const applied = applyMigrations(database);
    console.log(`Reset database and applied migrations: ${applied.join(", ")}\nDatabase: ${databasePath}`);
  } finally {
    database.close();
  }
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(1);

function getOptionValue(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function collectorSourcesForCommand(value: string): readonly DeckSource[] | undefined {
  if (value === "collect:all") {
    return ["mtgtop8", "mtgo", "mtggoldfish"];
  }

  if (value === "collect:mtgtop8") {
    return ["mtgtop8"];
  }

  if (value === "collect:mtgo") {
    return ["mtgo"];
  }

  if (value === "collect:mtggoldfish") {
    return ["mtggoldfish"];
  }

  return undefined;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  const parsed = value ? Number(value) : undefined;
  return parsed && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNumberOption(value: string | undefined): number | undefined {
  const parsed = value ? Number(value) : undefined;
  return parsed === undefined || Number.isNaN(parsed) ? undefined : parsed;
}

function parseCubeMode(value: string | undefined): "aggregate" | "historical" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "aggregate" || value === "historical") {
    return value;
  }

  console.error("cube:generate --mode must be aggregate or historical.");
  process.exit(1);
}

function parseReviewQueue(value: string | undefined): Parameters<typeof listManualReviewItems>[1] {
  if (
    value === "unresolved_cards" ||
    value === "archetype_gaps" ||
    value === "dedupe_ambiguities" ||
    value === "period_assignments" ||
    value === "historical_coverage" ||
    value === "parasitic_cards" ||
    value === "validation_warnings" ||
    value === "zero_support_cards"
  ) {
    return value;
  }

  return undefined;
}

function defaultBackupPath(filePath: string): string {
  if (filePath === ":memory:") {
    return path.join(process.cwd(), `cube-refiner-${Date.now()}.sqlite.bak`);
  }

  return `${filePath}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
}

function backupDatabaseFiles(filePath: string, outputPath: string): void {
  if (filePath === ":memory:") {
    console.error("Database backup requires a file-backed database path.");
    process.exit(1);
  }
  if (!existsSync(filePath)) {
    console.error(`Database does not exist: ${filePath}`);
    process.exit(1);
  }

  mkdirSync(path.dirname(outputPath), { recursive: true });
  copyFileSync(filePath, outputPath);
  for (const suffix of ["-shm", "-wal"]) {
    const sidecar = `${filePath}${suffix}`;
    if (existsSync(sidecar)) {
      copyFileSync(sidecar, `${outputPath}${suffix}`);
    }
  }
}
