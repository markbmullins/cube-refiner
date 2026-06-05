#!/usr/bin/env node

import { existsSync, rmSync } from "node:fs";

import { generateCandidatePools, generateCube, validateCube } from "../build/index.js";
import { runCollectors } from "../collectors/index.js";
import { defaultProjectPaths } from "../config/paths.js";
import { applyMigrations, openDatabase } from "../db/index.js";
import {
  dedupeDecks,
  fetchAndImportScryfallDefaultCards,
  importScryfallCardsFromFile,
  normalizeArchetypes,
  normalizeCards
} from "../normalize/index.js";
import { buildCardArchetypeMatrix, scoreCards } from "../scoring/index.js";
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
  cube-refiner db:init [--db path]
  cube-refiner db:migrate [--db path]
  cube-refiner db:reset [--db path]
  cube-refiner collect:all [--db path] [--raw-dir path] [--refresh]
  cube-refiner collect:mtgtop8 [--db path] [--raw-dir path] [--refresh]
  cube-refiner collect:mtgo [--db path] [--raw-dir path] [--refresh]
  cube-refiner collect:mtggoldfish [--db path] [--raw-dir path] [--refresh] [--events ids-or-urls]
  cube-refiner normalize:cards [--db path] [--scryfall-file path] [--fetch-scryfall] [--audit-csv path] [--fail-on-unknown]
  cube-refiner normalize:archetypes [--db path] [--mapping-file path] [--audit-csv path] [--fail-on-unmapped]
  cube-refiner dedupe:decks [--db path] [--report-csv path] [--near-overlap count]
  cube-refiner matrix:build [--db path] [--matrix-csv path] [--archetypes-csv path] [--pipeline-run-id id]
  cube-refiner score:cards [--db path] --pipeline-run-id id [--glue-threshold n] [--signpost-affinity n] [--signpost-exclusivity n] [--signpost-min-decks n]
  cube-refiner candidates:generate [--db path] --pipeline-run-id id [--output-dir path]
  cube-refiner cube:generate [--db path] --pipeline-run-id id [--cube-run-id id] [--output-csv path]
  cube-refiner cube:validate [--db path] --cube-run-id id [--validation-run-id id] [--output-csv path]

Project paths:
  raw data:        ${defaultProjectPaths.rawDataDir}
  normalized data: ${defaultProjectPaths.normalizedDataDir}
  outputs:         ${defaultProjectPaths.outputsDir}
  sqlite db:       ${defaultProjectPaths.sqliteDatabasePath}
`);
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

if (command === "db:reset") {
  if (databasePath === ":memory:") {
    console.error("db:reset requires a file-backed database path.");
    process.exit(1);
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
