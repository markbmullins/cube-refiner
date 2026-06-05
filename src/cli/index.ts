#!/usr/bin/env node

import { existsSync, rmSync } from "node:fs";

import { defaultProjectPaths } from "../config/paths.js";
import { applyMigrations, openDatabase } from "../db/index.js";

const args = process.argv.slice(2);
if (args[0] === "--") {
  args.shift();
}

const [command = "help"] = args;
const databasePath = getOptionValue("--db") ?? defaultProjectPaths.sqliteDatabasePath;

if (command === "help" || command === "--help" || command === "-h") {
  console.log(`cube-refiner

Usage:
  cube-refiner help
  cube-refiner db:init [--db path]
  cube-refiner db:migrate [--db path]
  cube-refiner db:reset [--db path]

Project paths:
  raw data:        ${defaultProjectPaths.rawDataDir}
  normalized data: ${defaultProjectPaths.normalizedDataDir}
  outputs:         ${defaultProjectPaths.outputsDir}
  sqlite db:       ${defaultProjectPaths.sqliteDatabasePath}
`);
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
