import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { listCubeRunCards } from "../db/index.js";

export type ExportCubeCobraOptions = {
  readonly cubeRunId: string;
  readonly outputPath: string;
};

export type ExportCubeCobraSummary = {
  readonly cards: number;
  readonly outputPath: string;
};

export function exportCubeCobra(database: DatabaseSync, options: ExportCubeCobraOptions): ExportCubeCobraSummary {
  const cards = listCubeRunCards(database, options.cubeRunId);

  mkdirSync(path.dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, cards.map((card) => `1 ${card.cardName}`).join("\n") + "\n");

  return {
    cards: cards.length,
    outputPath: options.outputPath
  };
}
