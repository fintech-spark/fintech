// Merchant Brain: PhonePe Pulse benchmark shaping unit tests.

import { describe, expect, it } from 'vitest';
import {
  periodKey,
  comparePeriods,
  isValidPeriod,
  previousQuarter,
  sameQuarterLastYear,
  buildTransactionTrend,
  buildGrowthSeries,
  rankGeographies,
  compareValues,
  latestPeriod,
  type PulseRow,
} from '@/modules/analytics/domain/phonepe-pulse';

describe('PhonePe Pulse Domain Shaping', () => {
  it('correctly calculates period keys and compares them', () => {
    expect(periodKey({ year: 2024, quarter: 1 })).toBe(20241);
    expect(comparePeriods({ year: 2024, quarter: 1 }, { year: 2024, quarter: 2 })).toBeLessThan(0);
    expect(comparePeriods({ year: 2025, quarter: 1 }, { year: 2024, quarter: 4 })).toBeGreaterThan(0);
    expect(comparePeriods({ year: 2024, quarter: 3 }, { year: 2024, quarter: 3 })).toBe(0);
  });

  it('validates periods correctly', () => {
    expect(isValidPeriod({ year: 2024, quarter: 2 })).toBe(true);
    expect(isValidPeriod({ year: 1999, quarter: 1 })).toBe(false);
    expect(isValidPeriod({ year: 2024, quarter: 0 })).toBe(false);
    expect(isValidPeriod({ year: 2024, quarter: 5 })).toBe(false);
  });

  it('computes previous quarters and same quarter last year', () => {
    expect(previousQuarter({ year: 2024, quarter: 1 })).toEqual({ year: 2023, quarter: 4 });
    expect(previousQuarter({ year: 2024, quarter: 3 })).toEqual({ year: 2024, quarter: 2 });
    expect(sameQuarterLastYear({ year: 2024, quarter: 2 })).toEqual({ year: 2023, quarter: 2 });
  });

  it('aggregates transaction trends per period', () => {
    const rows: PulseRow[] = [
      {
        year: 2024,
        quarter: 1,
        geo_name: 'india',
        parent_geo_name: null,
        segment: 'P2M',
        rank: null,
        transaction_count: 500,
        transaction_amount: 10000,
        registered_count: null,
      },
      {
        year: 2024,
        quarter: 1,
        geo_name: 'india',
        parent_geo_name: null,
        segment: 'P2P',
        rank: null,
        transaction_count: 1500,
        transaction_amount: 30000,
        registered_count: null,
      },
      {
        year: 2024,
        quarter: 2,
        geo_name: 'india',
        parent_geo_name: null,
        segment: 'P2M',
        rank: null,
        transaction_count: 3000,
        transaction_amount: 60000,
        registered_count: null,
      },
    ];

    const trend = buildTransactionTrend(rows);
    expect(trend).toEqual([
      { year: 2024, quarter: 1, transactionCount: 2000 },
      { year: 2024, quarter: 2, transactionCount: 3000 },
    ]);
  });

  it('builds growth series for registered counts', () => {
    const rows: PulseRow[] = [
      {
        year: 2024,
        quarter: 2,
        geo_name: 'india',
        parent_geo_name: null,
        segment: null,
        rank: null,
        transaction_count: null,
        transaction_amount: null,
        registered_count: 20000,
      },
      {
        year: 2024,
        quarter: 1,
        geo_name: 'india',
        parent_geo_name: null,
        segment: null,
        rank: null,
        transaction_count: null,
        transaction_amount: null,
        registered_count: 10000,
      },
    ];

    const growth = buildGrowthSeries(rows);
    expect(growth).toEqual([
      { year: 2024, quarter: 1, registered: 10000 },
      { year: 2024, quarter: 2, registered: 20000 },
    ]);
  });

  it('ranks geographies by count descending', () => {
    const rows: PulseRow[] = [
      {
        year: 2024,
        quarter: 1,
        geo_name: 'karnataka',
        parent_geo_name: 'india',
        segment: null,
        rank: 2,
        transaction_count: 5000,
        transaction_amount: 100000,
        registered_count: null,
      },
      {
        year: 2024,
        quarter: 1,
        geo_name: 'maharashtra',
        parent_geo_name: 'india',
        segment: null,
        rank: 1,
        transaction_count: 9000,
        transaction_amount: 180000,
        registered_count: null,
      },
    ];

    const ranked = rankGeographies(rows, 10);
    expect(ranked[0].name).toBe('maharashtra');
    expect(ranked[0].count).toBe(9000);
    expect(ranked[1].name).toBe('karnataka');
  });

  it('compares values and computes percentage delta', () => {
    const comp = compareValues(150, 100);
    expect(comp.change).toBe(50);
    expect(comp.changePct).toBe(50);

    const compZero = compareValues(100, 0);
    expect(compZero.changePct).toBeNull();
  });

  it('finds latest period in trend points', () => {
    const points = [
      { year: 2023, quarter: 4 },
      { year: 2024, quarter: 2 },
      { year: 2024, quarter: 1 },
    ];
    expect(latestPeriod(points)).toEqual({ year: 2024, quarter: 2 });
    expect(latestPeriod([])).toBeNull();
  });
});
