// Reporting-period arithmetic in a business's reporting timezone.
//
// The repository stores every timestamp as `timestamptz` and gives each
// business a `timezone` column (default `Asia/Kolkata`). Two conventions are
// fixed here and used everywhere else in the intelligence layer:
//
//  1. A `DateRange` is HALF-OPEN: `from` is inclusive, `to` is exclusive.
//     `[2026-01-01T00:00Z, 2026-02-01T00:00Z)` is January. This makes adjacent
//     periods join without double counting and makes period arithmetic exact.
//  2. Day, week and month boundaries are derived in the business reporting
//     timezone, never in the server's timezone. The server's local zone is an
//     implementation detail of the host and must never change a merchant's
//     numbers.
//
// No date library is installed and none is added: `Intl.DateTimeFormat` is the
// only timezone-safe primitive available, and it is sufficient here.

export const DEFAULT_REPORTING_TIMEZONE = 'Asia/Kolkata';

/** Half-open period: `from` inclusive, `to` exclusive. */
export interface HalfOpenPeriod {
  readonly from: Date;
  readonly to: Date;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, created);
  return created;
}

/**
 * Resolves the reporting timezone, falling back to the product default when the
 * stored value is missing or not a zone this runtime recognises. Falling back
 * rather than throwing keeps a merchant's intelligence readable while making the
 * fallback visible through the returned `fallback` flag.
 */
export function resolveReportingTimezone(stored: string | null | undefined): {
  readonly timeZone: string;
  readonly fallback: boolean;
} {
  const candidate = stored?.trim();
  if (candidate) {
    try {
      formatterFor(candidate).format(new Date(0));
      return { timeZone: candidate, fallback: false };
    } catch {
      // fall through to the default
    }
  }
  return { timeZone: DEFAULT_REPORTING_TIMEZONE, fallback: true };
}

interface ZonedWallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function wallClockOf(instant: Date, timeZone: string): ZonedWallClock {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const clock = wallClockOf(instant, timeZone);
  const asUtc = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
  // formatToParts truncates sub-second precision, so drop it before comparing.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Converts a wall-clock time in `timeZone` to the UTC instant.
 *
 * Runs the offset lookup twice so that a wall-clock time falling inside a
 * daylight-saving transition resolves against the offset actually in force at
 * the candidate instant, not the one before the transition.
 */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  timeZone: string = DEFAULT_REPORTING_TIMEZONE,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstGuessOffset = zoneOffsetMs(new Date(naive), timeZone);
  const firstCandidate = new Date(naive - firstGuessOffset);
  const correctedOffset = zoneOffsetMs(firstCandidate, timeZone);
  return new Date(naive - correctedOffset);
}

/** Instant of local midnight starting the reporting day that contains `instant`. */
export function startOfReportingDay(
  instant: Date,
  timeZone: string = DEFAULT_REPORTING_TIMEZONE,
): Date {
  const clock = wallClockOf(instant, timeZone);
  return zonedWallClockToUtc(clock.year, clock.month, clock.day, 0, 0, 0, timeZone);
}

/** Exclusive end of the reporting day that contains `instant` (next local midnight). */
export function endOfReportingDay(
  instant: Date,
  timeZone: string = DEFAULT_REPORTING_TIMEZONE,
): Date {
  const clock = wallClockOf(instant, timeZone);
  const nextDay = addCalendarDays({ year: clock.year, month: clock.month, day: clock.day }, 1);
  return zonedWallClockToUtc(nextDay.year, nextDay.month, nextDay.day, 0, 0, 0, timeZone);
}

/** Inclusive start of the reporting month that contains `instant`. */
export function startOfReportingMonth(
  instant: Date,
  timeZone: string = DEFAULT_REPORTING_TIMEZONE,
): Date {
  const clock = wallClockOf(instant, timeZone);
  return zonedWallClockToUtc(clock.year, clock.month, 1, 0, 0, 0, timeZone);
}

/** Exclusive end of the reporting month that contains `instant`. */
export function endOfReportingMonth(
  instant: Date,
  timeZone: string = DEFAULT_REPORTING_TIMEZONE,
): Date {
  const clock = wallClockOf(instant, timeZone);
  const nextMonth = clock.month === 12 ? 1 : clock.month + 1;
  const nextYear = clock.month === 12 ? clock.year + 1 : clock.year;
  return zonedWallClockToUtc(nextYear, nextMonth, 1, 0, 0, 0, timeZone);
}

/** Exclusive end of the reporting week (Saturday) containing `instant`. */
export function endOfReportingWeek(
  instant: Date,
  timeZone: string = DEFAULT_REPORTING_TIMEZONE,
): Date {
  const anchor = startOfReportingDay(instant, timeZone);
  const clock = wallClockOf(anchor, timeZone);
  const daysIntoWeek = dayOfWeekIndex({ year: clock.year, month: clock.month, day: clock.day });
  return new Date(anchor.getTime() + (7 - daysIntoWeek) * DAY_MS);
}

/** Calendar arithmetic on a plain date triple, with month-length clamping. */
export function addCalendarDays(
  date: { readonly year: number; readonly month: number; readonly day: number },
  days: number,
): { readonly year: number; readonly month: number; readonly day: number } {
  const asUtc = Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS;
  const shifted = new Date(asUtc);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

const DAY_MS = 86_400_000;

/** 0 = Sunday .. 6 = Saturday, matching the JavaScript `Date` convention. */
function dayOfWeekIndex(date: {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/**
 * The equivalent period immediately preceding `period`.
 *
 * Derived from the period's exact duration rather than the calendar, so it is
 * correct for every bucket size and for daylight-saving transitions: a period
 * spanning a DST change compares against a window of the identical length. When
 * a caller passes whole calendar months, the previous window is the previous
 * calendar month.
 */
export function previousEquivalentPeriod(period: HalfOpenPeriod): HalfOpenPeriod {
  const durationMs = period.to.getTime() - period.from.getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError(
      `Period must have a positive duration, got ${durationMs}ms (${period.from.toISOString()} -> ${period.to.toISOString()}).`,
    );
  }
  return { from: new Date(period.from.getTime() - durationMs), to: new Date(period.from) };
}

/** Whole-day span covered by a half-open period. */
export function periodLengthInDays(period: HalfOpenPeriod): number {
  return (period.to.getTime() - period.from.getTime()) / DAY_MS;
}

/** Splits a half-open period into consecutive non-overlapping daily windows. */
export function splitIntoReportingDays(
  period: HalfOpenPeriod,
  timeZone: string = DEFAULT_REPORTING_TIMEZONE,
): HalfOpenPeriod[] {
  const windows: HalfOpenPeriod[] = [];
  let cursor = startOfReportingDay(period.from, timeZone);
  if (cursor.getTime() < period.from.getTime()) cursor = period.from;
  while (cursor.getTime() < period.to.getTime()) {
    const boundary = endOfReportingDay(cursor, timeZone);
    const windowEnd = boundary.getTime() < period.to.getTime() ? boundary : period.to;
    windows.push({ from: cursor, to: windowEnd });
    cursor = windowEnd;
  }
  return windows;
}

/**
 * Splits a half-open period into calendar-month windows, clamping the first and
 * last window to the requested range.
 */
export function splitIntoReportingMonths(
  period: HalfOpenPeriod,
  timeZone: string = DEFAULT_REPORTING_TIMEZONE,
): HalfOpenPeriod[] {
  const windows: HalfOpenPeriod[] = [];
  let cursor = period.from;
  while (cursor.getTime() < period.to.getTime()) {
    const monthEnd = endOfReportingMonth(cursor, timeZone);
    const windowEnd = monthEnd.getTime() < period.to.getTime() ? monthEnd : period.to;
    windows.push({ from: cursor, to: windowEnd });
    cursor = windowEnd;
  }
  return windows;
}

/**
 * Splits a half-open period into consecutive seven-day windows anchored to the
 * local midnight preceding `period.from`.
 */
export function splitIntoWeeks(
  period: HalfOpenPeriod,
  timeZone: string = DEFAULT_REPORTING_TIMEZONE,
): HalfOpenPeriod[] {
  const anchor = startOfReportingDay(period.from, timeZone);
  const clock = wallClockOf(anchor, timeZone);
  const daysIntoWeek = dayOfWeekIndex({ year: clock.year, month: clock.month, day: clock.day });
  let cursor = new Date(anchor.getTime() - daysIntoWeek * DAY_MS);
  if (cursor.getTime() < period.from.getTime()) cursor = period.from;

  const windows: HalfOpenPeriod[] = [];
  while (cursor.getTime() < period.to.getTime()) {
    const windowEnd = new Date(cursor.getTime() + 7 * DAY_MS);
    const clampedEnd = windowEnd.getTime() < period.to.getTime() ? windowEnd : period.to;
    windows.push({ from: cursor, to: clampedEnd });
    cursor = clampedEnd;
  }
  return windows;
}

export type BucketGranularity = 'day' | 'week' | 'month';

/**
 * Chooses the reporting bucket size for a forecast horizon.
 *
 * A horizon longer than `WEEKLY_HORIZON_MAX_DAYS` is bucketed monthly, otherwise
 * weekly. Day buckets are never auto-selected: a daily horizon would produce a
 * per-day projection that no source table can support without inventing values.
 */
export const WEEKLY_HORIZON_MAX_DAYS = 84;

export function chooseBucketGranularity(period: HalfOpenPeriod): BucketGranularity {
  return periodLengthInDays(period) > WEEKLY_HORIZON_MAX_DAYS ? 'month' : 'week';
}

/** Splits a horizon into buckets using the granularity chosen for it. */
export function splitIntoBuckets(
  period: HalfOpenPeriod,
  granularity: BucketGranularity,
  timeZone: string = DEFAULT_REPORTING_TIMEZONE,
): HalfOpenPeriod[] {
  switch (granularity) {
    case 'day':
      return splitIntoReportingDays(period, timeZone);
    case 'week':
      return splitIntoWeeks(period, timeZone);
    case 'month':
      return splitIntoReportingMonths(period, timeZone);
  }
}

/** ISO-8601 calendar date (YYYY-MM-DD) of an instant in the reporting timezone. */
export function toReportingDateLabel(
  instant: Date,
  timeZone: string = DEFAULT_REPORTING_TIMEZONE,
): string {
  const clock = wallClockOf(instant, timeZone);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`;
}

/** Human-readable period label such as `2026-01-01 -> 2026-02-01`. */
export function describePeriod(
  period: HalfOpenPeriod,
  timeZone: string = DEFAULT_REPORTING_TIMEZONE,
): string {
  const from = toReportingDateLabel(period.from, timeZone);
  const toInclusive = new Date(period.to.getTime() - 1);
  return `${from} -> ${toInclusive.toISOString() && toReportingDateLabel(toInclusive, timeZone)}`;
}