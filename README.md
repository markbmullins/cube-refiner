# Cube Refiner

Cube Refiner is an ETL and analytics project for building a 2013-2017 Modern nostalgia cube from historical decklists.

The guiding workflow is:

1. Collect raw historical Modern decklists.
2. Normalize card names and archetype labels.
3. Deduplicate exact repeats and downweight near duplicates.
4. Build card/archetype matrices.
5. Score glue, affinity, exclusivity, signposts, parasitic cards, and final cube candidates.
6. Generate candidate pools.
7. Build a constrained 360-card cube.
8. Validate the cube and export human-friendly CSVs.

## Project Layout

```text
data/
  raw/          Raw source snapshots and parser audit artifacts
  normalized/   Optional normalized exports for inspection
  outputs/      Generated CSVs, Cube Cobra imports, and reports
src/
  cli/          Command-line entrypoint
  collectors/   Source-specific decklist collectors
  config/       Paths and project configuration
  normalize/    Card and archetype normalization
  scoring/      Matrix and scoring algorithms
  build/        Candidate-pool and cube-generation logic
  export/       CSV and Cube Cobra exporters
  types/        Shared data contracts
```

## Persistence Model

SQLite is the canonical working store for the pipeline. The default database path is:

```text
data/cube-refiner.sqlite
```

Raw JSON snapshots and CSV files are still useful, but they are audit and export artifacts rather than the primary handoff between stages.

## Development

Requires Node.js 24 or newer. Cube Refiner uses Node's built-in `node:sqlite` module for the on-disk database layer.

```bash
pnpm install
pnpm check
pnpm test
pnpm build
pnpm dev -- help
```

## Database Commands

```bash
pnpm dev -- db:init
pnpm dev -- db:migrate
pnpm dev -- db:reset
pnpm dev -- db:init --db data/cube-refiner.sqlite
```

## Collector Commands

```bash
pnpm collect:all
pnpm collect:mtgtop8
pnpm collect:mtgo
pnpm collect:mtggoldfish
```

Collector runs write source snapshots under `data/raw/{source}/`, upsert raw deck metadata and cards into SQLite, and emit parsed deck JSON snapshots for auditability.

MTGTop8 supports focused historical runs:

```bash
pnpm collect:mtgtop8 -- --years 2015 --limit-events 1 --limit-decks 2
```

MTGO supports year/month filtered Modern decklist pages:

```bash
pnpm collect:mtgo -- --years 2026 --months 05 --limit-events 1 --limit-decks 2
```

MTGGoldfish supports explicit tournament archive inputs by slug, numeric ID, or full URL:

```bash
pnpm collect:mtggoldfish -- --events grand-prix-las-vegas-2017-modern,23447 --limit-decks 8
```

When `--events` is omitted, the collector uses a small set of known historical Modern tournament archives and can be filtered with `--years`.

## Normalization Commands

Card normalization imports canonical card records into SQLite, maps raw card names to canonical names, writes normalized deck-card rows, and emits an audit CSV.

Use a local Scryfall default-cards JSON file:

```bash
pnpm normalize:cards -- --scryfall-file data/scryfall-default-cards.json
```

Or fetch Scryfall default-cards bulk data during the run:

```bash
pnpm normalize:cards -- --fetch-scryfall
```

Unknown card names are persisted as unresolved mapping rows with source/deck context. Add `--fail-on-unknown` when you want the run to fail after writing the audit trail.

Archetype normalization uses `data/archetype-mappings.json` by default and updates normalized decks with both an archetype and broader archetype family:

```bash
pnpm normalize:archetypes
pnpm normalize:archetypes -- --mapping-file data/archetype-mappings.json --fail-on-unmapped
```

Unmapped or ambiguous labels are persisted in SQLite for review and written to `data/outputs/archetype_audit.csv`.

Deduplication computes deterministic mainboard fingerprints, assigns exact duplicate and near-duplicate clusters, persists deck weights in SQLite, and writes a review report:

```bash
pnpm dedupe:decks
pnpm dedupe:decks -- --near-overlap 55 --report-csv data/outputs/dedupe_report.csv
```

Exact duplicate copies are weighted to `0` after the deterministic representative. Near duplicates in the same archetype family and month are downweighted rather than removed.

Build the weighted card/archetype matrix and archetype summaries:

```bash
pnpm matrix:build
pnpm matrix:build -- --matrix-csv data/outputs/card_archetype_matrix.csv --archetypes-csv data/outputs/archetypes_summary.csv
```

Matrix rows are persisted in SQLite by pipeline run id, and CSVs are exports from those persisted rows.

Score cards from a persisted matrix run:

```bash
pnpm score:cards -- --pipeline-run-id <run-id>
pnpm score:cards -- --pipeline-run-id <run-id> --glue-threshold 0.10 --signpost-affinity 0.60 --signpost-exclusivity 0.40 --signpost-min-decks 5
```

Scoring writes `cards_ranked.csv`, `signpost_candidates.csv`, `glue_cards.csv`, and `parasitic_review.csv` from persisted `card_scores` rows.

## Shared Contracts

The initial shared contracts live in `src/types/contracts.ts` and cover:

- `RawDeck`
- `DeckCard`
- `NormalizedDeck`
- matrix rows
- score rows
- candidate pools
- generated cube candidates
- validation summaries
- pipeline runs
