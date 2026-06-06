import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { historicalConfigHash, loadHistoricalModernConfig, validateHistoricalModernConfig } from "./historicalProfile.js";

describe("historical Modern config profiles", () => {
  it("loads the checked-in default historical profile", () => {
    const loaded = loadHistoricalModernConfig();

    expect(loaded.config.project.name).toBe("Historical Modern Cube");
    expect(loaded.config.historical.dateRange).toEqual({ endDate: "2019-04-30", startDate: "2011-08-12" });
    expect(loaded.config.historical.periodModel).toBe("standard_set_release");
    expect(loaded.config.sources.outOfRangeHandling).toBe("quarantine");
    expect(loaded.config.coverage.minimumDecksPerSourcePeriod).toBe(1);
    expect(loaded.configHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails invalid dates, inverted ranges, unknown period models, and missing weights", () => {
    expect(() =>
      loadHistoricalModernConfig({
        profileConfig: { historical: { dateRange: { startDate: "2011-99-99" } } }
      })
    ).toThrow(/Invalid historical start date/);

    expect(() =>
      loadHistoricalModernConfig({
        profileConfig: { historical: { dateRange: { endDate: "2011-08-11", startDate: "2011-08-12" } } }
      })
    ).toThrow(/must be on or before end date/);

    expect(() =>
      loadHistoricalModernConfig({
        profileConfig: { historical: { periodModel: "year" } }
      })
    ).toThrow(/Unsupported historical period model/);

    expect(() =>
      validateHistoricalModernConfig({
        ...loadHistoricalModernConfig().config,
        scoring: {
          manualOverrides: [],
          normalization: loadHistoricalModernConfig().config.scoring.normalization,
          thresholds: loadHistoricalModernConfig().config.scoring.thresholds,
          weights: { glue: 0.2 }
        }
      })
    ).toThrow(/scoring.weights.archetypeImportance/);
  });

  it("merges repo defaults, named profile config, file config, and CLI overrides in precedence order", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cube-refiner-config-"));
    const configPath = path.join(dir, "historical.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        historical: { dateRange: { endDate: "2018-12-31" } },
        scoring: { weights: { peak: 0.42 } }
      })
    );

    const loaded = loadHistoricalModernConfig({
      configPath,
      overrides: { dateRange: { endDate: "2019-04-30" } },
      profileConfig: {
        project: { name: "Named Profile" },
        scoring: { weights: { peak: 0.4 } }
      }
    });

    expect(loaded.config.project.name).toBe("Named Profile");
    expect(loaded.config.scoring.weights.peak).toBe(0.42);
    expect(loaded.config.historical.dateRange.endDate).toBe("2019-04-30");
  });

  it("produces stable hashes for equivalent config object orderings", () => {
    const loaded = loadHistoricalModernConfig();
    const reordered = {
      validation: loaded.config.validation,
      sources: loaded.config.sources,
      setReleaseCalendar: loaded.config.setReleaseCalendar,
      scoring: loaded.config.scoring,
      project: loaded.config.project,
      historical: loaded.config.historical,
      exports: loaded.config.exports,
      cubeGeneration: loaded.config.cubeGeneration,
      coverage: loaded.config.coverage,
      archetypeReconstruction: loaded.config.archetypeReconstruction
    };

    expect(historicalConfigHash(reordered)).toBe(loaded.configHash);
  });
});
