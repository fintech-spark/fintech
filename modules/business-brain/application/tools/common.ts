// Merchant Brain: shared tool building blocks
//
// Two invariants live here because every tool depends on them:
//
//   PERIODS ARE EXPLICIT. A tool that returns money without saying which window
//   it covers produces an unfalsifiable number. `periodFields` requires the
//   caller to name the window, and the provenance envelope echoes it.
//
//   MONEY IS INTEGER MINOR UNITS WITH A CURRENCY. There is no FX conversion in
//   this codebase, so a bare number would be ambiguous the moment a tenant
//   holds two currencies. `metric()` builds the only shape a numeric answer may
//   take.

import { z } from 'zod';
import {
  boundedDateRangeSchema,
  boundedLimitSchema,
  currencySchema,
  deterministicMetricSchema,
  minorUnitsSchema,
  searchTermSchema,
} from '@/lib/ai/tools/schemas';
import type { BoundedDateRangeInput } from '@/lib/ai/tools/schemas';
import { DEFAULT_TOOL_LIMITS } from '@/lib/ai/tools/types';
import { calculateChangeBps } from '@/modules/analytics';
// Two modules export a function named `calculateMarginBps` with INVERTED
// argument order:
//   modules/analytics  (profit, revenue)  -> (profit / revenue)
//   modules/inventory   (costPrice, sellingPrice) -> (sellingPrice - costPrice) / sellingPrice
// Importing the inventory one and calling it as (grossProfit, revenue) silently
// returns the COGS ratio, so the import is aliased to name the argument order.
import { calculateMarginBps as marginFromProfitAndRevenue } from '@/modules/analytics';
import type { CurrencyCode, DateRange, Money } from '@/lib/types';

/** Default reporting window: the trailing 30 days. */
export const DEFAULT_WINDOW_DAYS = 30;

/** Resolves a tool input into a concrete, half-open date range. */
export function toDateRange(input: BoundedDateRangeInput): DateRange {
  return {
    from: new Date(input.periodStart),
    to: new Date(input.periodEnd),
  };
}

/** The immediately preceding window of equal length, for period comparison. */
export function previousPeriod(period: DateRange): DateRange {
  const span = period.to.getTime() - period.from.getTime();
  return { from: new Date(period.from.getTime() - span), to: period.from };
}

export function isoRange(period: DateRange): { periodStart: string; periodEnd: string } {
  return { periodStart: period.from.toISOString(), periodEnd: period.to.toISOString() };
}

/**
 * A strictly increasing period of `days`, ending now.
 *
 * Used when a caller supplies no window. Bounded by the same limits as an
 * explicit window so the default can never be wider than the ceiling.
 */
export function trailingPeriod(days: number, now: Date = new Date()): DateRange {
  const span = Math.min(days, DEFAULT_WINDOW_DAYS) * 24 * 60 * 60 * 1000;
  return { from: new Date(now.getTime() - span), to: now };
}

export { boundedDateRangeSchema, boundedLimitSchema, searchTermSchema, deterministicMetricSchema, currencySchema, minorUnitsSchema };

/**
 * Schema builders bound to the shipped limits.
 *
 * Built once so no tool can accidentally enforce a different ceiling than the
 * registry does, and so the bound appears in one place when a limit changes.
 */
export const TOOL_SCHEMAS = {
  period: boundedDateRangeSchema(DEFAULT_TOOL_LIMITS),
  limit: boundedLimitSchema(DEFAULT_TOOL_LIMITS),
  narrowLimit: boundedLimitSchema({ ...DEFAULT_TOOL_LIMITS, maxRows: 25 }),
  term: searchTermSchema(DEFAULT_TOOL_LIMITS),
};

/** Output fields that make a period-scoped result unambiguous. */
export const periodOutputShape = {
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  period: z.object({ start: z.string().min(1), end: z.string().min(1) }).strict(),
};

/** `{ periodStart, periodEnd }` fields every period-scoped tool must carry. */
export function periodFields(period: DateRange) {
  return {
    periodStart: period.from.toISOString(),
    periodEnd: period.to.toISOString(),
    period: { start: period.from.toISOString(), end: period.to.toISOString() },
  };
}

/**
 * Builds a metric with deterministic change against a comparison window.
 *
 * `changeBps` comes from `calculateChangeBps` in `modules/analytics` — the
 * model is handed the already-computed basis-point delta and never asked to
 * divide.
 */
export function metric(input: {
  readonly name: string;
  readonly value: Money | number;
  readonly period: DateRange;
  readonly source: 'database' | 'analytics' | 'domain_service';
  readonly previousValue?: number;
}) {
  const amount = typeof input.value === 'number' ? input.value : input.value.amount;
  const currency: CurrencyCode = typeof input.value === 'number' ? 'INR' : input.value.currency;

  return {
    ...deterministicMetricSchema.parse({
      metric: input.name,
      valueMinorUnits: amount,
      currency,
      periodStart: input.period.from.toISOString(),
      periodEnd: input.period.to.toISOString(),
      source: input.source,
    }),
    ...(input.previousValue === undefined
      ? {}
      : {
          changeBps: calculateChangeBps(amount, input.previousValue),
          previousValueMinorUnits: input.previousValue,
        }),
  };
}

/**
 * Gross profit and margin for a revenue/cost pair.
 *
 * Delegates to the deterministic rules rather than computing inline, so a tool
 * answer and a route answer cannot disagree by a rounding step.
 */
export function profitAndMargin(revenueMinor: number, costMinor: number, currency: CurrencyCode) {
  const grossProfitMinor = revenueMinor - costMinor;
  return {
    grossProfitMinor,
    grossMarginBps: marginFromProfitAndRevenue(grossProfitMinor, revenueMinor),
    currency,
  };
}

/** A plain count, which needs no currency. */
export function count(name: string, value: number) {
  return z.object({ metric: z.literal(name), value: z.number().int(), unit: z.literal('count') }).parse({
    metric: name,
    value,
    unit: 'count',
  });
}
