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
