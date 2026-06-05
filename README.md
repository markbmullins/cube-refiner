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
  pipeline.ts   End-to-end pipeline orchestration
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
pnpm dev -- db:status
pnpm dev -- db:reviews
pnpm dev -- db:artifacts
pnpm dev -- db:configs
pnpm dev -- db:backup --output data/cube-refiner.sqlite.bak
pnpm dev -- db:check
pnpm dev -- db:vacuum
pnpm dev -- db:reset --force --backup data/cube-refiner.sqlite.bak
pnpm dev -- db:init --db data/cube-refiner.sqlite
```

`db:status` summarizes migrations, table counts, pending review items, latest pipeline stages, saved config profiles, artifact counts, and stale artifact paths. `db:reviews` lists unresolved cards, archetype mapping gaps, near-duplicate review clusters, parasitic-card candidates, validation warnings, and zero-support cube cards without opening CSVs by hand. Destructive reset commands require `--force`; use `db:backup` or `db:reset --backup <path>` before replacing useful local state.

## Historical Metagame Periods

Historical Modern uses Standard set release windows as its primary metagame periods. A release window starts on a Standard-legal core or expansion release date and ends on the day before the next Standard-legal release, clipped to the configured project start and end dates. This gives cards credit for how they lived through real metagame shifts instead of flattening everything into one aggregate frequency pool or coarse annual buckets.

The bundled calendar lives at `data/standard-set-releases.json`. The default historical range is August 12, 2011 through April 30, 2019, so the first generated period starts inside the Magic 2012 window and the final default period is clipped before War of the Spark.

```bash
pnpm dev -- periods:seed
pnpm dev -- periods:generate --start-date 2011-08-12 --end-date 2019-04-30 --model standard-set-release
pnpm dev -- periods:list
pnpm dev -- periods:assign
pnpm dev -- db:reviews --queue period_assignments
```

`periods:generate` seeds the release calendar into SQLite before creating `metagame_periods`, so a clean database can be initialized with one command. `periods:assign` maps normalized decks to periods by event date and persists out-of-range or invalid dates in the `period_assignments` review queue.

Audit historical source coverage after periods exist:

```bash
pnpm dev -- coverage:historical --min-decks 8
pnpm dev -- db:reviews --queue historical_coverage
```

The coverage command refreshes deck-to-period assignments, writes `data/outputs/historical_source_coverage.csv`, persists period/source/archetype-family coverage rows, and registers the CSV as an artifact. The report includes a year rollup column for readability, but every warning is anchored to the primary set-release period. Empty periods, periods below the configured deck threshold, and zero-count sources marked `unknown` or `unavailable` in `data/source-coverage-manifest.json` become DB-backed review warnings so missing source coverage is not treated as zero observed play.

## End-to-End Pipeline

Run the full DB-first pipeline from collection through validation and exports:

```bash
pnpm pipeline:run -- --scryfall-file data/scryfall-default-cards.json
```

For local iteration against decklists and cards already stored in SQLite, skip live collection:

```bash
pnpm pipeline:run -- --skip-collect --pipeline-run-id modern-nostalgia-v1 --total-cards 360
```

The full pipeline records a `pipeline_runs` row, stage lineage rows, a saved `pipeline:latest` config profile, and artifact registry rows for generated CSV/text outputs. Targeted commands use the same SQLite tables between stages; CSV and JSON files are raw snapshots, audits, or exports.

Major outputs are written to `data/outputs/` by default:

- `cards_ranked.csv`
- `card_archetype_matrix.csv`
- `archetypes_summary.csv`
- `signpost_candidates.csv`
- `glue_cards.csv`
- `parasitic_review.csv`
- `cube_360_candidate.csv`
- `cube_validation_report.csv`
- `cube_cobra_import.txt`
- `historical_source_coverage.csv`

The key construction idea is to use scoring to produce explainable candidate pools first, then let the cube generator apply constraints for section balance, fixing, archetype support, curve, and role coverage instead of simply taking the top 360 cards by score.

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

Generate explainable candidate pools for cube construction:

```bash
pnpm candidates:generate -- --pipeline-run-id <run-id>
```

This persists candidate assignments in SQLite and exports `auto_includes.csv`, `glue_cards.csv`, `signpost_cards.csv`, `parasitic_review.csv`, `sideboard_cards.csv`, `lands.csv`, `removal.csv`, and `threats.csv`.

Generate the constrained first-pass 360-card cube:

```bash
pnpm cube:generate -- --pipeline-run-id <run-id>
```

The cube generator stores a cube run, selected cards, roles, and reason fields in SQLite, then exports `data/outputs/cube_360_candidate.csv`.

Validate a generated cube:

```bash
pnpm cube:validate -- --cube-run-id <cube-run-id>
pnpm cube:validate -- --cube-run-id <cube-run-id> --min-removal 35 --max-zero-support-cards 25
```

Validation stores a validation run, aggregate health metrics, per-archetype support counts, warning rows, and zero-support card review rows in SQLite. The CSV at `data/outputs/cube_validation_report.csv` is a reproducible export from the stored validation run.

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
- Standard set releases
- metagame periods
- deck-to-period assignments and review rows
- historical source coverage rows and warnings
