import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  listMetagamePeriods,
  listNormalizedDeckPeriodCandidates,
  listSetReleases,
  replaceDeckMetagamePeriodAssignments,
  replaceMetagamePeriods,
  replaceSetReleases
} from "./db/repository.js";
import type {
  MetaPeriod,
  MetagamePeriodAssignmentReview,
  MetagamePeriodModel,
  SetRelease,
  StandardSetType
} from "./types/contracts.js";

export const standardSetReleaseModel: MetagamePeriodModel = "standard_set_release";
export const standardSetReleaseCliModel = "standard-set-release";
export const defaultHistoricalStartDate = "2011-08-12";
export const defaultHistoricalEndDate = "2019-04-30";
export const defaultSetReleaseCalendarPath = path.join(process.cwd(), "data", "standard-set-releases.json");

export type GenerateMetagamePeriodsOptions = {
  readonly startDate: string;
  readonly endDate: string;
  readonly model?: MetagamePeriodModel;
};

export type PersistedMetagamePeriodsSummary = {
  readonly model: MetagamePeriodModel;
  readonly startDate: string;
  readonly endDate: string;
  readonly periods: number;
  readonly configHash: string;
};

export type DeckPeriodAssignmentSummary = {
  readonly assignedDecks: number;
  readonly reviewRows: number;
};

export function loadSetReleaseCalendar(filePath: string = defaultSetReleaseCalendarPath): readonly SetRelease[] {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Set release calendar must be a JSON array: ${filePath}`);
  }

  return parsed.map((entry) => normalizeSetRelease(entry));
}

export function seedSetReleases(
  database: DatabaseSync,
  options: { readonly setReleasesFile?: string } = {}
): number {
  const releases = loadSetReleaseCalendar(options.setReleasesFile);
  replaceSetReleases(database, releases);
  return releases.length;
}

export function generateMetagamePeriods(
  releases: readonly SetRelease[],
  options: GenerateMetagamePeriodsOptions
): readonly MetaPeriod[] {
  const model = options.model ?? standardSetReleaseModel;
  if (model !== standardSetReleaseModel) {
    throw new Error(`Unsupported metagame period model: ${model}`);
  }

  validateDateRange(options.startDate, options.endDate);

  const sorted = [...releases]
    .filter((release) => release.setType === "core" || release.setType === "expansion")
    .sort((left, right) => compareDate(left.releaseDate, right.releaseDate) || left.setCode.localeCompare(right.setCode));
  const firstAnchorIndex = findFirstAnchorIndex(sorted, options.startDate);
  if (firstAnchorIndex === -1) {
    throw new Error(`No Standard set release found on or before configured start date ${options.startDate}.`);
  }

  const periods: MetaPeriod[] = [];
  let sortOrder = 0;
  for (let index = firstAnchorIndex; index < sorted.length; index += 1) {
    const release = sorted[index];
    const nextRelease = sorted[index + 1];
    if (!release) {
      continue;
    }
    if (compareDate(release.releaseDate, options.endDate) > 0) {
      break;
    }

    const startDate = maxDate(release.releaseDate, options.startDate);
    const naturalEndDate = nextRelease ? subtractOneUtcDay(nextRelease.releaseDate) : options.endDate;
    const endDate = minDate(naturalEndDate, options.endDate);
    if (compareDate(startDate, endDate) > 0) {
      continue;
    }

    periods.push({
      endDate,
      model,
      periodId: periodIdFor(model, release.setCode, startDate),
      releaseDate: release.releaseDate,
      setCode: release.setCode,
      setName: release.setName,
      sortOrder,
      startDate
    });
    sortOrder += 1;
  }

  return periods;
}

export function generateAndPersistMetagamePeriods(
  database: DatabaseSync,
  options: GenerateMetagamePeriodsOptions
): PersistedMetagamePeriodsSummary {
  const periods = generateMetagamePeriods(listSetReleases(database), options);
  const configHash = hashPeriodConfig(options);
  replaceMetagamePeriods(database, periods, configHash);
  return {
    configHash,
    endDate: options.endDate,
    model: options.model ?? standardSetReleaseModel,
    periods: periods.length,
    startDate: options.startDate
  };
}

export function assignDecksToMetagamePeriods(database: DatabaseSync): DeckPeriodAssignmentSummary {
  const periods = listMetagamePeriods(database, standardSetReleaseModel);
  const candidates = listNormalizedDeckPeriodCandidates(database);
  const assignments: { readonly deckId: string; readonly periodId: string }[] = [];
  const reviews: MetagamePeriodAssignmentReview[] = [];

  for (const candidate of candidates) {
    const eventDate = candidate.eventDate;
    if (!eventDate) {
      reviews.push({
        deckId: candidate.deckId,
        reason: "missing_event_date"
      });
      continue;
    }
    if (!isIsoDate(eventDate)) {
      reviews.push({
        deckId: candidate.deckId,
        eventDate,
        reason: "invalid_event_date"
      });
      continue;
    }

    const period = periods.find((entry) => compareDate(entry.startDate, eventDate) <= 0 && compareDate(eventDate, entry.endDate) <= 0);
    if (!period) {
      reviews.push({
        deckId: candidate.deckId,
        eventDate,
        metadata: {
          firstPeriodStartDate: periods[0]?.startDate,
          lastPeriodEndDate: periods.at(-1)?.endDate
        },
        reason: "out_of_range"
      });
      continue;
    }

    assignments.push({
      deckId: candidate.deckId,
      periodId: period.periodId
    });
  }

  replaceDeckMetagamePeriodAssignments(database, assignments, reviews);
  return {
    assignedDecks: assignments.length,
    reviewRows: reviews.length
  };
}

export function parseMetagamePeriodModel(value: string | undefined): MetagamePeriodModel {
  if (!value || value === standardSetReleaseCliModel || value === standardSetReleaseModel) {
    return standardSetReleaseModel;
  }

  throw new Error(`Unsupported period model "${value}". Use ${standardSetReleaseCliModel}.`);
}

function findFirstAnchorIndex(releases: readonly SetRelease[], startDate: string): number {
  let anchorIndex = -1;
  for (let index = 0; index < releases.length; index += 1) {
    const release = releases[index];
    if (release && compareDate(release.releaseDate, startDate) <= 0) {
      anchorIndex = index;
    }
  }

  return anchorIndex;
}

function normalizeSetRelease(value: unknown): SetRelease {
  if (value === null || typeof value !== "object") {
    throw new Error("Set release calendar entries must be objects.");
  }

  const record = value as Record<string, unknown>;
  const setCode = readRequiredString(record, "setCode").toLowerCase();
  const setName = readRequiredString(record, "setName");
  const releaseDate = readRequiredString(record, "releaseDate");
  const setType = readRequiredString(record, "setType");
  const source = readRequiredString(record, "source");
  if (!isIsoDate(releaseDate)) {
    throw new Error(`Invalid release date for ${setCode}: ${releaseDate}`);
  }
  if (!isStandardSetType(setType)) {
    throw new Error(`Invalid Standard set type for ${setCode}: ${setType}`);
  }

  return {
    metadata: record.metadata,
    releaseDate,
    setCode,
    setName,
    setType,
    source
  };
}

function validateDateRange(startDate: string, endDate: string): void {
  if (!isIsoDate(startDate)) {
    throw new Error(`Invalid start date: ${startDate}`);
  }
  if (!isIsoDate(endDate)) {
    throw new Error(`Invalid end date: ${endDate}`);
  }
  if (compareDate(startDate, endDate) > 0) {
    throw new Error(`Start date ${startDate} must be on or before end date ${endDate}.`);
  }
}

function isStandardSetType(value: string): value is StandardSetType {
  return value === "core" || value === "expansion";
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = parseUtcDate(value);
  return formatUtcDate(date) === value;
}

function compareDate(left: string, right: string): number {
  return left.localeCompare(right);
}

function maxDate(left: string, right: string): string {
  return compareDate(left, right) >= 0 ? left : right;
}

function minDate(left: string, right: string): string {
  return compareDate(left, right) <= 0 ? left : right;
}

function subtractOneUtcDay(value: string): string {
  const date = parseUtcDate(value);
  date.setUTCDate(date.getUTCDate() - 1);
  return formatUtcDate(date);
}

function parseUtcDate(value: string): Date {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

function formatUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function periodIdFor(model: MetagamePeriodModel, setCode: string, startDate: string): string {
  return `${model}_${setCode}_${startDate}`;
}

function hashPeriodConfig(options: GenerateMetagamePeriodsOptions): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        endDate: options.endDate,
        model: options.model ?? standardSetReleaseModel,
        startDate: options.startDate
      })
    )
    .digest("hex");
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Set release calendar entry missing string field: ${key}`);
  }

  return value;
}
