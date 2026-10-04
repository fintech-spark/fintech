// Merchant Brain: PhonePe Pulse infrastructure repository.
//
// Reads public benchmark data from `public.phonepe_pulse_metrics`.
//
// DESIGN & ARCHITECTURE INVARIANTS:
//   - National benchmark data is strictly public reference data, NOT tenant data.
//     There is no `business_id` column on this table and it is never mixed into
//     a merchant's private ledger or Money types.
//   - Parameterized SQL only: every parameter is passed as a positional bind ($1, $2).
//   - Computations (sums, deltas, rankings, share ratios) are handled deterministically
//     via the domain layer (`../domain/phonepe-pulse.ts`), never guessed by an AI model.

import 'server-only';

import type { DatabaseClient } from '@/lib/database/client';
import {
  buildGrowthSeries,
  buildTransactionTrend,
  compareValues,
  latestPeriod,
  previousQuarter,
  rankGeographies,
  sameQuarterLastYear,
  type Comparison,
  type GeoMetric,
  type GrowthPoint,
  type PulsePeriod,
  type PulseRow,
  type TrendPoint,
} from '../domain/phonepe-pulse';

export interface CategoryBreakdown {
  readonly category: string;
  readonly transactionCount: number;
  readonly sharePct: number;
}

export interface PhonePePulseBenchmarkSummary {
  readonly period: PulsePeriod;
  readonly nationalMetrics: {
    readonly transactionCount: number;
    readonly transactionAmount: number | null;
    readonly registeredUsers: number | null;
  };
  readonly comparisons: {
    readonly quarterOverQuarter: Comparison | null;
    readonly yearOverYear: Comparison | null;
  };
  readonly nationalTrend: readonly TrendPoint[];
  readonly userGrowth: readonly GrowthPoint[];
  readonly categoryBreakdown: readonly CategoryBreakdown[];
  readonly topStates: readonly GeoMetric[];
}

export interface PhonePePulseRepository {
  getNationalTrend(): Promise<readonly TrendPoint[]>;
  getUserGrowthTrend(): Promise<readonly GrowthPoint[]>;
  getTopStates(year: number, quarter: number, limit?: number): Promise<readonly GeoMetric[]>;
  getCategoryBreakdown(year: number, quarter: number): Promise<readonly CategoryBreakdown[]>;
  getBenchmarkSummary(targetPeriod?: PulsePeriod): Promise<PhonePePulseBenchmarkSummary>;
}

// ---------------------------------------------------------------------------
// Static Parameterized SQL Queries
// ---------------------------------------------------------------------------

const SQL_NATIONAL_TRANSACTION_TREND = `
  SELECT
    year,
    quarter,
    geo_name,
    parent_geo_name,
    segment,
    rank,
    transaction_count,
    transaction_amount,
    registered_count
  FROM public.phonepe_pulse_metrics
  WHERE dataset_type = 'transaction'
    AND category = 'aggregated'
    AND scope = 'country'
    AND geo_level = 'country'
  ORDER BY year ASC, quarter ASC
`;

const SQL_NATIONAL_USER_GROWTH = `
  SELECT
    year,
    quarter,
    geo_name,
    parent_geo_name,
    segment,
    rank,
    transaction_count,
    transaction_amount,
    registered_count
  FROM public.phonepe_pulse_metrics
  WHERE dataset_type = 'user'
    AND category = 'aggregated'
    AND scope = 'country'
    AND geo_level = 'country'
  ORDER BY year ASC, quarter ASC
`;

const SQL_STATE_MAP_METRICS = `
  SELECT
    year,
    quarter,
    geo_name,
    parent_geo_name,
    segment,
    rank,
    transaction_count,
    transaction_amount,
    registered_count
  FROM public.phonepe_pulse_metrics
  WHERE dataset_type = 'transaction'
    AND category = 'map'
    AND scope = 'country'
    AND geo_level = 'state'
    AND year = $1
    AND quarter = $2
  ORDER BY transaction_count DESC NULLS LAST
`;

const SQL_NATIONAL_AGGREGATED_CATEGORIES = `
  SELECT
    year,
    quarter,
    geo_name,
    parent_geo_name,
    segment,
    rank,
    transaction_count,
    transaction_amount,
    registered_count
  FROM public.phonepe_pulse_metrics
  WHERE dataset_type = 'transaction'
    AND category = 'aggregated'
    AND scope = 'country'
    AND geo_level = 'country'
    AND year = $1
    AND quarter = $2
  ORDER BY transaction_count DESC NULLS LAST
`;

const SQL_NATIONAL_TOTAL_AMOUNT = `
  SELECT
    sum(transaction_amount)::numeric as total_amount
  FROM public.phonepe_pulse_metrics
  WHERE dataset_type = 'transaction'
    AND category = 'map'
    AND scope = 'country'
    AND geo_level = 'state'
    AND year = $1
    AND quarter = $2
`;

interface TotalAmountRow {
  readonly total_amount: number | null;
}

export class PostgresPhonePePulseRepository implements PhonePePulseRepository {
  constructor(private readonly db: DatabaseClient) {}

  async getNationalTrend(): Promise<readonly TrendPoint[]> {
    const rows = await this.db.query<PulseRow>(SQL_NATIONAL_TRANSACTION_TREND);
    return buildTransactionTrend(rows);
  }

  async getUserGrowthTrend(): Promise<readonly GrowthPoint[]> {
    const rows = await this.db.query<PulseRow>(SQL_NATIONAL_USER_GROWTH);
    return buildGrowthSeries(rows);
  }

  async getTopStates(year: number, quarter: number, limit = 10): Promise<readonly GeoMetric[]> {
    const rows = await this.db.query<PulseRow>(SQL_STATE_MAP_METRICS, [year, quarter]);
    return rankGeographies(rows, limit);
  }

  async getCategoryBreakdown(year: number, quarter: number): Promise<readonly CategoryBreakdown[]> {
    const rows = await this.db.query<PulseRow>(SQL_NATIONAL_AGGREGATED_CATEGORIES, [year, quarter]);
    const totalCount = rows.reduce(
      (sum, r) => sum + (typeof r.transaction_count === 'number' ? r.transaction_count : 0),
      0,
    );

    return rows.map((row) => {
      const count = typeof row.transaction_count === 'number' ? row.transaction_count : 0;
      const sharePct = totalCount > 0 ? Math.round((count / totalCount) * 10_000) / 100 : 0;
      return {
        category: row.segment ?? 'Other',
        transactionCount: count,
        sharePct,
      };
    });
  }

  async getBenchmarkSummary(targetPeriod?: PulsePeriod): Promise<PhonePePulseBenchmarkSummary> {
    const [nationalTrend, userGrowth] = await Promise.all([
      this.getNationalTrend(),
      this.getUserGrowthTrend(),
    ]);

    const activePeriod = targetPeriod ?? latestPeriod(nationalTrend) ?? { year: 2026, quarter: 2 };

    const currentPoint = nationalTrend.find(
      (p) => p.year === activePeriod.year && p.quarter === activePeriod.quarter,
    );
    const currentUserPoint = userGrowth.find(
      (u) => u.year === activePeriod.year && u.quarter === activePeriod.quarter,
    );

    const prevQ = previousQuarter(activePeriod);
    const prevYear = sameQuarterLastYear(activePeriod);

    const prevQPoint = nationalTrend.find(
      (p) => p.year === prevQ.year && p.quarter === prevQ.quarter,
    );
    const prevYearPoint = nationalTrend.find(
      (p) => p.year === prevYear.year && p.quarter === prevYear.quarter,
    );

    const currentCount = currentPoint?.transactionCount ?? 0;

    const qoqComparison = prevQPoint
      ? compareValues(currentCount, prevQPoint.transactionCount)
      : null;
    const yoyComparison = prevYearPoint
      ? compareValues(currentCount, prevYearPoint.transactionCount)
      : null;

    const [topStates, categoryBreakdown, totalAmountRows] = await Promise.all([
      this.getTopStates(activePeriod.year, activePeriod.quarter, 10),
      this.getCategoryBreakdown(activePeriod.year, activePeriod.quarter),
      this.db.query<TotalAmountRow>(SQL_NATIONAL_TOTAL_AMOUNT, [activePeriod.year, activePeriod.quarter]),
    ]);

    const transactionAmount = totalAmountRows.length > 0 && typeof totalAmountRows[0].total_amount === 'number'
      ? totalAmountRows[0].total_amount
      : null;

    return {
      period: activePeriod,
      nationalMetrics: {
        transactionCount: currentCount,
        transactionAmount,
        registeredUsers: currentUserPoint?.registered ?? null,
      },
      comparisons: {
        quarterOverQuarter: qoqComparison,
        yearOverYear: yoyComparison,
      },
      nationalTrend,
      userGrowth,
      categoryBreakdown,
      topStates,
    };
  }
}
