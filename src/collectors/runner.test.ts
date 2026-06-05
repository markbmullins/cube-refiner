import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCollectors } from "./runner.js";

describe("collector runner", () => {
  it("runs registered source commands independently and writes parsed snapshots", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cube-refiner-runner-"));
    const databasePath = path.join(root, "collector.sqlite");
    const rawDataDir = path.join(root, "raw");

    const summaries = await runCollectors({
      databasePath,
      logger: {
        error: () => undefined,
        info: () => undefined,
        warn: () => undefined
      },
      rawDataDir,
      sources: ["mtgtop8"]
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.source).toBe("mtgtop8");
    expect(summaries[0]?.deckCount).toBe(0);
    expect(summaries[0]?.parsedOutputPath).toContain(path.join("mtgtop8", "parsed"));
    expect(existsSync(summaries[0]?.parsedOutputPath ?? "")).toBe(true);
    expect(JSON.parse(readFileSync(summaries[0]?.parsedOutputPath ?? "", "utf8"))).toEqual([]);
  });
});
