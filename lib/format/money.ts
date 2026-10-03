// Merchant Brain: money and quantity presentation.
//
// The backend owns every amount. These helpers FORMAT an authoritative value
// and never derive a new one. Amounts arrive as integer minor units (paise)
// per `lib/types.ts` — a float here would be a rounding bug, not a nicety.
//
// Three rules from AI_CONTEXT.md §5 and DESIGN_SYSTEM.md drive this file:
//   1. No arithmetic. `formatMoney` does not add, convert or rescale.
//   2. No silent precision loss. Compact notation always keeps the exact
//      figure reachable (see `formatMoneyCompact`).
//   3. Percentages and percentage points are different units and are never
//      rendered with the same token.

import type { CurrencyCode, Money } from "@/lib/types";

/** Minor-unit exponent per currency. Only currencies the backend accepts. */
const MINOR_UNIT_DIGITS: Readonly<Record<CurrencyCode, number>> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
};

/** Locale used for presentation. Matches the primary market in PRODUCT_SPEC.md. */
const LOCALE = "en-IN";

const formatterCache = new Map<string, Intl.NumberFormat>();

function currencyFormatter(
  currency: CurrencyCode,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = `${currency}:${JSON.stringify(options)}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    ...options,
  });
  formatterCache.set(key, created);
  return created;
}

/**
 * Converts integer minor units to the major-unit value `Intl` expects.
 *
 * Division is the only operation performed here, and it happens at the
 * presentation boundary so no other layer ever handles fractional money.
 */
export function toMajorUnits(
  minorUnits: number,
  currency: CurrencyCode,
): number {
  const digits = MINOR_UNIT_DIGITS[currency] ?? 2;
  return minorUnits / 10 ** digits;
}

/**
 * Formats a backend `Money` value for display. `null` and `undefined` render
 * as an em dash so a missing value is visibly missing rather than `₹0.00`.
 */
export function formatMoney(
  value: Money | null | undefined,
  options: { readonly compact?: boolean } = {},
): string {
  if (!value) return "—";
  return formatMinorUnits(value.amount, value.currency, options);
}

/** Formats a bare minor-unit amount when the currency is already known. */
export function formatMinorUnits(
  minorUnits: number,
  currency: CurrencyCode,
  options: { readonly compact?: boolean } = {},
): string {
  if (!Number.isFinite(minorUnits)) return "—";
  const major = toMajorUnits(minorUnits, currency);
  if (options.compact) {
    return currencyFormatter(currency, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(major);
  }
  // Two fraction digits, because paise are real money to a merchant.
  return currencyFormatter(currency, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
}

/**
 * Compact money for dense contexts (chart axes, KPI tiles) that also returns
 * the exact figure, so the precise value is never lost.
 */
export function formatMoneyCompact(
  value: Money | null | undefined,
): { readonly compact: string; readonly exact: string } {
  if (!value) return { compact: "—", exact: "Not available" };
  return {
    compact: formatMoney(value, { compact: true }),
    exact: formatMoney(value),
  };
}

/**
 * Signed money, used for deltas and scenario differences.
 *
 * The sign is explicit (`+` / `−`) because a bare number next to a label like
 * "change" is ambiguous, and a Unicode minus keeps columns aligned.
 */
export function formatMoneyDelta(
  value: Money | null | undefined,
): { readonly text: string; readonly direction: "up" | "down" | "flat" } {
  if (!value) return { text: "—", direction: "flat" };
  if (value.amount === 0) return { text: formatMoney(value), direction: "flat" };
  const sign = value.amount > 0 ? "+" : "−";
  const magnitude = formatMoney({
    amount: Math.abs(value.amount),
    currency: value.currency,
  });
  return {
    text: `${sign}${magnitude}`,
    direction: value.amount > 0 ? "up" : "down",
  };
}

/**
 * A relative change expressed in percent, e.g. a margin moving 18.4% → 21.1%.
 *
 * This is a RATIO between two already-authoritative figures. The caller
 * supplies both; nothing is recomputed from raw amounts here beyond the
 * ratio the caller asked for. Returns `null` when the comparison is
 * undefined (zero base) so the UI can say "no prior period" instead of
 * printing `Infinity%`.
 */
export function formatPercentChange(
  current: number,
  previous: number,
  options: { readonly fractionDigits?: number } = {},
): { readonly text: string; readonly direction: "up" | "down" | "flat" } | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }
  const change = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(change)) return null;
  const digits = options.fractionDigits ?? 1;
  const rounded = Number(change.toFixed(digits));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return {
    text: `${sign}${Math.abs(rounded).toFixed(digits)}%`,
    direction: rounded > 0 ? "up" : rounded < 0 ? "down" : "flat",
  };
}

/**
 * A change in PERCENTAGE POINTS — the unit used when a margin moves from
 * 18.4% to 21.1%. Rendering that as "+15%" would overstate the change by an
 * order of magnitude, so it gets its own token and its own wording.
 */
export function formatPointChange(
  current: number,
  previous: number,
  options: { readonly fractionDigits?: number } = {},
): { readonly text: string; readonly direction: "up" | "down" | "flat" } | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const change = current - previous;
  const digits = options.fractionDigits ?? 1;
  const rounded = Number(change.toFixed(digits));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return {
    text: `${sign}${Math.abs(rounded).toFixed(digits)} pts`,
    direction: rounded > 0 ? "up" : rounded < 0 ? "down" : "flat",
  };
}

/** A standalone percentage that is already authoritative (e.g. a margin). */
export function formatPercent(
  value: number | null | undefined,
  options: { readonly fractionDigits?: number } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const digits = options.fractionDigits ?? 1;
  return `${value.toFixed(digits)}%`;
}

/**
 * Quantities. `maximumFractionDigits: 3` mirrors the Postgres
 * `numeric(20,3)` used by inventory, so a displayed stock level always fits
 * what the database can actually store.
 */
export function formatQuantity(
  value: number | null | undefined,
  unit?: string | null,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const digits = Number.isInteger(value) ? 0 : 3;
  const formatted = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Signed integer counts, e.g. "2 items need review". */
export function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  const formatted = new Intl.NumberFormat(LOCALE).format(value);
  return `${formatted} ${value === 1 ? singular : plural}`;
}

/** Byte sizes for ingested documents. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}