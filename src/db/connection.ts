import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type OpenDatabaseOptions = {
  readonly path: string;
};

export function openDatabase(options: OpenDatabaseOptions): DatabaseSync {
  if (options.path !== ":memory:") {
    mkdirSync(path.dirname(options.path), { recursive: true });
  }

  const database = new DatabaseSync(options.path);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA busy_timeout = 5000;");

  if (options.path !== ":memory:") {
    database.exec("PRAGMA journal_mode = WAL;");
  }

  return database;
}
