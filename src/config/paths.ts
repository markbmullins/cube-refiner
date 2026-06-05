import path from "node:path";

export type ProjectPaths = {
  readonly dataDir: string;
  readonly rawDataDir: string;
  readonly normalizedDataDir: string;
  readonly outputsDir: string;
  readonly sqliteDatabasePath: string;
};

export const defaultProjectPaths: ProjectPaths = {
  dataDir: "data",
  normalizedDataDir: path.join("data", "normalized"),
  outputsDir: path.join("data", "outputs"),
  rawDataDir: path.join("data", "raw"),
  sqliteDatabasePath: path.join("data", "cube-refiner.sqlite")
};
