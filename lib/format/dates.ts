// Merchant Brain: date, time and period presentation.
//
// `Intl.DateTimeFormat` everywhere (web-design-guidelines: no hardcoded
// formats). The reporting period is never implicit — DESIGN_SYSTEM.md
// requires the active window to be visible wherever figures are shown, so
// `PeriodPreset` is part of the URL state, not local component state.

/** Preset reporting windows offered in the UI. All are half-open in intent. */
export const PERIOD_PRESETS = [
  "today",
  "last_7_days",
  "last_30_days",
  "this_month",
  "previous_month",
  "custom",
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export interface PeriodPresetDefinition {
  readonly id: PeriodPreset;
  readonly label: string;
  readonly description: string;
}

/**
 * Merchant-facing labels. "Last 30 days" not "30d" — a merchant should not
 * have to decode a reporting window.
 */
export const PERIOD_PRESET_DEFINITIONS: readonly PeriodPresetDefinition[] = [
  { id: "today", label: "Today", description: "From midnight to now" },
  {
    id: "last_7_days",
    label: "Last 7 days",
    description: "The previous 7 days, including today",
  },
  {
    id: "last_30_days",
    label: "Last 30 days",
    description: "The previous 30 days, including today",
  },
  {
    id: "this_month",
    label: "This month",
    description: "From the 1st of this month to now",
  },
  {
    id: "previous_month",
    label: "Previous month",
    description: "The full calendar month before this one",
  },
  {
    id: "custom",
    label: "Custom range",
    description: "Choose your own start and end dates",
  },
];

const PRESET_BY_ID = new Map(PERIOD_PRESET_DEFINITIONS.map((d) => [d.id, d]));

export function isPeriodPreset(value: string): value is PeriodPreset {
  return PRESET_BY_ID.has(value as PeriodPreset);
}

export function periodLabel(preset: PeriodPreset): string {
  return PRESET_BY_ID.get(preset)?.label ?? "Selected period";
}

export function periodDescription(preset: PeriodPreset): string {
  return PRESET_BY_ID.get(preset)?.description ?? "";
}

/** Resolves a preset to concrete ISO bounds for the API query string. */
export function resolvePeriod(
  preset: PeriodPreset,
  now: Date = new Date(),
): { readonly from: string; readonly to: string } {
  const to = now;
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate());

  switch (preset) {
    case "today":
      return { from: startOfDay(now).toISOString(), to: to.toISOString() };
    case "last_7_days": {
      const from = startOfDay(now);
      from.setDate(from.getDate() - 6);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    case "last_30_days": {
      const from = startOfDay(now);
      from.setDate(from.getDate() - 29);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    case "this_month":
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        to: to.toISOString(),
      };
    case "previous_month": {
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { from: start.toISOString(), to: end.toISOString() };
    }
    case "custom":
      // A custom range has no preset bounds. Callers supply their own; this
      // fallback exists so the type stays total and never throws mid-render.
      return { from: startOfDay(now).toISOString(), to: to.toISOString() };
  }
}

/**
 * Parses a date-only string from the URL without letting the local timezone
 * shift the day. `new Date("2026-03-01")` is UTC midnight, which renders as
 * the previous day for merchants west of Greenwich — a real class of
 * off-by-one bug in reporting UIs.
 */
export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }
  return date;
}

/** Formats a date-only value for `<input type="date">`. */
export function toDateInputValue(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDate(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** "01 Mar 2026" — unambiguous for document and invoice references. */
export function formatDateLong(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

const RELATIVE_UNITS: readonly { readonly limit: number; readonly unit: Intl.RelativeTimeFormatUnit }[] =
  [
    { limit: 60, unit: "second" },
    { limit: 3600, unit: "minute" },
    { limit: 86400, unit: "hour" },
    { limit: 604800, unit: "day" },
    { limit: 2629800, unit: "week" },
    { limit: 31557600, unit: "month" },
  ];

/**
 * Freshness copy for "Updated 12 minutes ago".
 *
 * `now` is injectable so server and client renders agree — a relative time
 * computed from `Date.now()` on both sides is a guaranteed hydration
 * mismatch. The server passes its own clock and the client re-computes only
 * after mount.
 */
export function formatRelativeTime(
  value: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  const date = toDate(value);
  if (!date) return "Never";
  const deltaSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const absolute = Math.abs(deltaSeconds);
  if (absolute < 10) return "just now";

  let divisor = 1;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  for (const candidate of RELATIVE_UNITS) {
    if (absolute < candidate.limit) {
      unit = candidate.unit;
      break;
    }
    divisor = candidate.limit;
    unit = candidate.unit;
  }
  const formatter = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto" });
  return formatter.format(Math.round(deltaSeconds / divisor), unit);
}

/**
 * Days between today and a due date, negative when overdue.
 * Returns `null` for an unparseable date so callers show "—" rather than a
 * fabricated day count.
 */
export function daysUntil(
  dueDate: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  const date = toDate(dueDate);
  if (!date) return null;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDue = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((startOfDue.getTime() - startOfToday.getTime()) / 86_400_000);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}