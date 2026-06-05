import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  listNormalizedDeckArchetypes,
  updateNormalizedDeckArchetype,
  upsertArchetypeMapping
} from "../db/index.js";

export type ArchetypeMappingConfigEntry = {
  readonly archetype: string;
  readonly archetypeFamily: string;
  readonly confidence?: number;
  readonly labels: readonly string[];
  readonly manualOverride?: boolean;
};

export type ArchetypeNormalizationOptions = {
  readonly auditCsvPath?: string;
  readonly failOnUnmapped?: boolean;
  readonly mappingFilePath?: string;
  readonly mappings?: readonly ArchetypeMappingConfigEntry[];
};

export type ArchetypeAuditRow = {
  readonly reportedLabel: string;
  readonly archetype: string;
  readonly archetypeFamily: string;
  readonly auditStatus: "mapped" | "ambiguous" | "unmapped";
  readonly confidence: number;
};

export type NormalizeArchetypesSummary = {
  readonly ambiguousLabels: number;
  readonly auditCsvPath?: string;
  readonly mappedLabels: number;
  readonly normalizedDecks: number;
  readonly unmappedLabels: number;
};

export function normalizeArchetypes(
  database: DatabaseSync,
  options: ArchetypeNormalizationOptions = {}
): NormalizeArchetypesSummary {
  const mappings = options.mappings ?? loadArchetypeMappings(options.mappingFilePath);
  const resolver = createArchetypeResolver(mappings);
  const decks = listNormalizedDeckArchetypes(database);
  const auditByLabel = new Map<string, ArchetypeAuditRow>();
  let normalizedDecks = 0;

  for (const deck of decks) {
    const resolution = resolver(deck.archetype);
    auditByLabel.set(deck.archetype, resolution);
    upsertArchetypeMapping(database, {
      archetype: resolution.archetype,
      archetypeFamily: resolution.archetypeFamily,
      auditStatus: resolution.auditStatus,
      confidence: resolution.confidence,
      manualOverride: resolution.auditStatus === "mapped" ? mappingManualOverride(mappings, deck.archetype) : false,
      reportedLabel: resolution.reportedLabel
    });

    updateNormalizedDeckArchetype(database, {
      archetype: resolution.archetype,
      archetypeFamily: resolution.archetypeFamily,
      deckId: deck.deckId
    });
    normalizedDecks += 1;
  }

  const auditRows = [...auditByLabel.values()].sort((a, b) => a.reportedLabel.localeCompare(b.reportedLabel));
  if (options.auditCsvPath) {
    writeAuditCsv(options.auditCsvPath, auditRows);
  }

  const unmappedLabels = auditRows.filter((row) => row.auditStatus === "unmapped").length;
  const ambiguousLabels = auditRows.filter((row) => row.auditStatus === "ambiguous").length;
  if (options.failOnUnmapped === true && (unmappedLabels > 0 || ambiguousLabels > 0)) {
    throw new Error(
      `Unresolved archetype labels: ${auditRows
        .filter((row) => row.auditStatus !== "mapped")
        .map((row) => row.reportedLabel)
        .join(", ")}`
    );
  }

  return {
    ambiguousLabels,
    auditCsvPath: options.auditCsvPath,
    mappedLabels: auditRows.length - unmappedLabels - ambiguousLabels,
    normalizedDecks,
    unmappedLabels
  };
}

export function loadArchetypeMappings(filePath = path.join("data", "archetype-mappings.json")): readonly ArchetypeMappingConfigEntry[] {
  return JSON.parse(readFileSync(filePath, "utf8")) as readonly ArchetypeMappingConfigEntry[];
}

export function createArchetypeResolver(
  mappings: readonly ArchetypeMappingConfigEntry[]
): (reportedLabel: string) => ArchetypeAuditRow {
  const mappingByKey = new Map<string, ArchetypeMappingConfigEntry[]>();

  for (const mapping of mappings) {
    for (const label of mapping.labels) {
      const key = archetypeKey(label);
      mappingByKey.set(key, [...(mappingByKey.get(key) ?? []), mapping]);
    }
  }

  return (reportedLabel) => {
    const matches = mappingByKey.get(archetypeKey(reportedLabel)) ?? [];
    if (matches.length === 0) {
      return {
        archetype: reportedLabel,
        archetypeFamily: "Unmapped",
        auditStatus: "unmapped",
        confidence: 0,
        reportedLabel
      };
    }

    const distinctTargets = new Map(matches.map((match) => [targetKey(match), match]));
    if (distinctTargets.size > 1) {
      return {
        archetype: reportedLabel,
        archetypeFamily: "Ambiguous",
        auditStatus: "ambiguous",
        confidence: Math.max(...matches.map((match) => match.confidence ?? 1)),
        reportedLabel
      };
    }

    const [match] = matches;
    if (!match) {
      throw new Error(`Could not resolve archetype mapping for ${reportedLabel}`);
    }

    return {
      archetype: match.archetype,
      archetypeFamily: match.archetypeFamily,
      auditStatus: "mapped",
      confidence: match.confidence ?? 1,
      reportedLabel
    };
  };
}

export function archetypeKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function mappingManualOverride(mappings: readonly ArchetypeMappingConfigEntry[], reportedLabel: string): boolean {
  const key = archetypeKey(reportedLabel);
  return mappings.some((mapping) => mapping.manualOverride === true && mapping.labels.some((label) => archetypeKey(label) === key));
}

function targetKey(mapping: ArchetypeMappingConfigEntry): string {
  return `${mapping.archetype}\0${mapping.archetypeFamily}`;
}

function writeAuditCsv(filePath: string, rows: readonly ArchetypeAuditRow[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      "reported_label,archetype,archetype_family,audit_status,confidence",
      ...rows.map((row) =>
        [
          row.reportedLabel,
          row.archetype,
          row.archetypeFamily,
          row.auditStatus,
          String(row.confidence)
        ].map(csvEscape).join(",")
      )
    ].join("\n") + "\n"
  );
}

function csvEscape(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, "\"\"")}"`;
}
