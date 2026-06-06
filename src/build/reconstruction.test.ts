import { describe, expect, it } from "vitest";

import type { CardPeriodMatrixRow } from "../types/contracts.js";
import { deriveReconstructionTargets, evaluateTargetsForCube } from "./reconstruction.js";

describe("archetype reconstruction", () => {
  it("scores archetype packages and rewards shared glue overlap", () => {
    const targets = deriveReconstructionTargets(periodRows, "period-run", {
      coreShare: 0.2,
      reconstructionThreshold: 0.5,
      signpostShare: 0.15,
      supportShare: 0.08
    });
    const result = evaluateTargetsForCube(
      targets,
      new Set(["Tarmogoyf", "Lightning Bolt", "Splinter Twin", "Deceiver Exarch", "Birthing Pod", "Kitchen Finks"]),
      "cube-run",
      "period-run",
      {
        coreShare: 0.2,
        reconstructionThreshold: 0.5,
        signpostShare: 0.15,
        supportShare: 0.08
      }
    );

    expect(
      result.rows.map((row) => ({
        archetypeFamily: row.archetypeFamily,
        missingCoreCards: row.missingCoreCards,
        periodId: row.periodId,
        reconstructionScore: row.reconstructionScore > 0
      }))
    ).toEqual([
      {
        archetypeFamily: "Jund",
        missingCoreCards: [],
        periodId: "p1",
        reconstructionScore: true
      },
      {
        archetypeFamily: "Pod",
        missingCoreCards: [],
        periodId: "p1",
        reconstructionScore: true
      },
      {
        archetypeFamily: "Twin",
        missingCoreCards: [],
        periodId: "p1",
        reconstructionScore: true
      }
    ]);
    expect(result.summary.archetypesAboveThreshold).toBe(3);
    expect(result.summary.periodsRepresented).toBe(1);
    expect(result.summary.sharedCardEfficiency).toBeGreaterThan(0);
  });

  it("emits warnings when core packages are missing", () => {
    const targets = deriveReconstructionTargets(periodRows, "period-run", {
      coreShare: 0.2,
      reconstructionThreshold: 0.5,
      signpostShare: 0.15,
      supportShare: 0.08
    });
    const result = evaluateTargetsForCube(targets, new Set(["Lightning Bolt"]), "cube-run", "period-run");

    expect(result.rows.flatMap((row) => row.warnings)).toContain("Missing core cards: Tarmogoyf");
    expect(result.rows.flatMap((row) => row.warnings)).toContain("Missing core cards: Birthing Pod");
  });

  it("applies per-archetype thresholds, manual targets, glue bonuses, and parasitic caps", () => {
    const targets = deriveReconstructionTargets(periodRows, "period-run", {
      configHash: "reconstruction-config",
      enabledArchetypeFamilies: ["Jund", "Twin"],
      manualOverrides: [
        {
          archetypeFamily: "Twin",
          cardName: "Pestermite",
          importance: 1,
          periodId: "p1",
          targetRole: "support"
        }
      ],
      perArchetype: {
        Twin: {
          minimumReconstructionScore: 0.9,
          minimumSupportCards: 2,
          minimumSignposts: 1
        }
      },
      sharedGlueBonus: 0.2
    });
    const result = evaluateTargetsForCube(targets, new Set(["Lightning Bolt", "Splinter Twin"]), "cube-run", "period-run", {
      configHash: "reconstruction-config",
      ecosystemDiversity: {
        maximumSingleArchetypeDominance: 0.5,
        minimumReconstructedArchetypeFamilies: 2,
        minimumRepresentedPeriods: 1,
        minimumSharedCardEfficiency: 0.5
      },
      parasiticPackageCaps: {
        Twin: 1
      },
      perArchetype: {
        Twin: {
          minimumReconstructionScore: 0.9,
          minimumSupportCards: 2,
          minimumSignposts: 1
        }
      }
    });

    expect(targets.map((target) => target.archetypeFamily)).not.toContain("Pod");
    expect(targets.find((target) => target.cardName === "Pestermite")).toEqual(
      expect.objectContaining({ configHash: "reconstruction-config", targetRole: "support" })
    );
    expect(targets.find((target) => target.cardName === "Lightning Bolt")?.importance).toBeGreaterThan(0.2);
    expect(result.rows.find((row) => row.archetypeFamily === "Twin")?.warnings).toEqual(
      expect.arrayContaining([
        "Twin below configured reconstruction score 0.9",
        "Twin below configured support card minimum 2",
        "Twin below configured signpost minimum 1",
        "Twin exceeds configured parasitic package cap 1"
      ])
    );
    expect(result.summary.configHash).toBe("reconstruction-config");
    expect(result.summary.summary).toEqual(
      expect.objectContaining({
        ecosystemWarnings: expect.arrayContaining(["Reconstructed archetypes below configured minimum 2"])
      })
    );
  });
});

const periodRows: readonly CardPeriodMatrixRow[] = [
  cardRow("Jund", "Tarmogoyf", 0.3),
  cardRow("Jund", "Lightning Bolt", 0.24, ["Jund", "Twin"]),
  cardRow("Twin", "Splinter Twin", 0.28),
  cardRow("Twin", "Deceiver Exarch", 0.24),
  cardRow("Pod", "Birthing Pod", 0.32),
  cardRow("Pod", "Kitchen Finks", 0.12)
];

function cardRow(
  archetypeFamily: string,
  cardName: string,
  metagameShare: number,
  archetypeFamilies: readonly string[] = [archetypeFamily]
): CardPeriodMatrixRow {
  return {
    archetypeFamilies,
    cardName,
    decksWithCard: metagameShare * 10,
    mainboardCopies: 4,
    metagameShare,
    periodEndDate: "2012-01-31",
    periodId: "p1",
    periodStartDate: "2012-01-01",
    pipelineRunId: "period-run",
    setCode: "p1",
    setName: "Period 1",
    sideboardCopies: 0,
    sortOrder: 0,
    totalDecksInPeriod: 10
  };
}
