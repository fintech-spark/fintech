// Merchant Brain: PhonePe Pulse benchmark shaping (pure, deterministic).
//
// PhonePe Pulse is PUBLIC, NATIONAL benchmark data. It is never tenant data and
// is never added to a merchant's own money. This file only reshapes rows that
// the database already holds; every figure is a sum or a ratio computed here in
// code, never by a model.
//
// Counts are transaction/registration COUNTS. The published snapshot carries no
// rupee amount for the aggregated and top datasets, so none is invented.

export interface PulsePeriod {
  readonly year: number;
  readonly quarter: number;
}

/** A row of `public.phonepe_pulse_metrics`, narrowed to what shaping needs. */
export interface PulseRow {
  readonly year: number;
  readonly quarter: number;
  readonly geo_name: string;
  readonly parent_geo_name: string | null;
  readonly segment: string | null;
  readonly rank: number | null;
  readonly transaction_count: number | null;
  readonly transaction_amount: number | null;
  readonly registered_count: number | null;
}

export interface TrendPoint extends PulsePeriod {
  readonly transactionCount: number;
}

export interface GrowthPoint extends PulsePeriod {
  readonly registered: number;
}

export interface GeoMetric {
  readonly name: string;
  readonly parent: string | null;
  readonly rank: number | null;
  readonly count: number;
  readonly amount: number | null;
}

export interface Comparison {
  readonly current: number;
  readonly previous: number;
  readonly change: number;
  /** `null` when the previous value is zero — a ratio would be meaningless. */
  readonly changePct: number | null;
}

/** Orders periods chronologically: 2018 Q1 < 2018 Q2 < 2019 Q1. */
export function periodKey(period: PulsePeriod): number {
  return period.year * 10 + period.quarter;
}

export function comparePeriods(a: PulsePeriod, b: PulsePeriod): number {
  return periodKey(a) - periodKey(b);
}

export function isValidPeriod(period: PulsePeriod): boolean {
  return (
    Number.isInteger(period.year) &&
    Number.isInteger(period.quarter) &&
    period.year >= 2000 &&
    period.year <= 2100 &&
    period.quarter >= 1 &&
    period.quarter <= 4
  );
}

/** The quarter immediately before `period`. */
export function previousQuarter(period: PulsePeriod): PulsePeriod {
  return period.quarter === 1
    ? { year: period.year - 1, quarter: 4 }
    : { year: period.year, quarter: period.quarter - 1 };
}

/** The same quarter one year earlier. */
export function sameQuarterLastYear(period: PulsePeriod): PulsePeriod {
  return { year: period.year - 1, quarter: period.quarter };
}

function nonNegative(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Sums every payment-category segment of a quarter into one national total. */
export function buildTransactionTrend(rows: readonly PulseRow[]): TrendPoint[] {
  const byPeriod = new Map<number, TrendPoint>();
  for (const row of rows) {
    const key = periodKey(row);
    const existing = byPeriod.get(key);
    byPeriod.set(key, {
      year: row.year,
      quarter: row.quarter,
      transactionCount: (existing?.transactionCount ?? 0) + nonNegative(row.transaction_count),
    });
  }
  return [...byPeriod.values()].sort(comparePeriods);
}

/** One registered-count per quarter (users or merchants), oldest first. */
export function buildGrowthSeries(rows: readonly PulseRow[]): GrowthPoint[] {
  const byPeriod = new Map<number, GrowthPoint>();
  for (const row of rows) {
    byPeriod.set(periodKey(row), {
      year: row.year,
      quarter: row.quarter,
      registered: nonNegative(row.registered_count),
    });
  }
  return [...byPeriod.values()].sort(comparePeriods);
}

/** Geography rows ranked by transaction count, highest first, ties by name. */
export function rankGeographies(rows: readonly PulseRow[], limit: number): GeoMetric[] {
  return rows
    .map((row) => ({
      name: row.geo_name,
      parent: row.parent_geo_name,
      rank: row.rank,
      count: nonNegative(row.transaction_count ?? row.registered_count),
      amount: row.transaction_amount,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit));
}

export function compareValues(current: number, previous: number): Comparison {
  const change = current - previous;
  return {
    current,
    previous,
    change,
    changePct: previous === 0 ? null : Math.round((change / previous) * 10_000) / 100,
  };
}

/** The most recent period present in a trend, or `null` for an empty dataset. */
export function latestPeriod(points: readonly PulsePeriod[]): PulsePeriod | null {
  let latest: PulsePeriod | null = null;
  for (const point of points) {
    if (latest === null || comparePeriods(point, latest) > 0) {
      latest = { year: point.year, quarter: point.quarter };
    }
  }
  return latest;
}
