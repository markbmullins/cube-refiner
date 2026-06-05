#!/usr/bin/env node

import { defaultProjectPaths } from "../config/paths.js";

const [, , command = "help"] = process.argv;

if (command === "help" || command === "--help" || command === "-h") {
  console.log(`cube-refiner

Usage:
  cube-refiner help

Project paths:
  raw data:        ${defaultProjectPaths.rawDataDir}
  normalized data: ${defaultProjectPaths.normalizedDataDir}
  outputs:         ${defaultProjectPaths.outputsDir}
  sqlite db:       ${defaultProjectPaths.sqliteDatabasePath}
`);
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(1);
