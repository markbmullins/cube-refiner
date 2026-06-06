export type HistoricalDateRange = {
  readonly startDate: string;
  readonly endDate: string;
};

export const defaultHistoricalDateRange: HistoricalDateRange = {
  endDate: "2019-04-30",
  startDate: "2011-08-12"
};

export function parseHistoricalDateRange(options: {
  readonly startDate?: string;
  readonly endDate?: string;
} = {}): HistoricalDateRange {
  const range = {
    endDate: options.endDate ?? defaultHistoricalDateRange.endDate,
    startDate: options.startDate ?? defaultHistoricalDateRange.startDate
  };
  validateHistoricalDateRange(range);
  return range;
}

export function validateHistoricalDateRange(range: HistoricalDateRange): void {
  if (!isIsoDate(range.startDate)) {
    throw new Error(`Invalid historical start date: ${range.startDate}`);
  }
  if (!isIsoDate(range.endDate)) {
    throw new Error(`Invalid historical end date: ${range.endDate}`);
  }
  if (range.startDate.localeCompare(range.endDate) > 0) {
    throw new Error(`Historical start date ${range.startDate} must be on or before end date ${range.endDate}.`);
  }
}

export function isDateInHistoricalRange(value: string, range: HistoricalDateRange): boolean {
  return isIsoDate(value) && range.startDate.localeCompare(value) <= 0 && value.localeCompare(range.endDate) <= 0;
}

export function yearsForHistoricalDateRange(range: HistoricalDateRange): readonly number[] {
  const years: number[] = [];
  const startYear = Number(range.startDate.slice(0, 4));
  const endYear = Number(range.endDate.slice(0, 4));
  for (let year = startYear; year <= endYear; year += 1) {
    years.push(year);
  }
  return years;
}

export function monthsForHistoricalDateRange(range: HistoricalDateRange, year: number): readonly string[] {
  const startYear = Number(range.startDate.slice(0, 4));
  const endYear = Number(range.endDate.slice(0, 4));
  const startMonth = year === startYear ? Number(range.startDate.slice(5, 7)) : 1;
  const endMonth = year === endYear ? Number(range.endDate.slice(5, 7)) : 12;
  const months: string[] = [];
  for (let month = startMonth; month <= endMonth; month += 1) {
    months.push(String(month).padStart(2, "0"));
  }
  return months;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map((part) => Number(part));
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).toISOString().slice(0, 10) === value;
}
