import { describe, it, expect, vi } from 'vitest';
import type { DatabaseClient } from '@/lib/database/client';
import {
  PostgresPhonePePulseRepository,
} from '@/modules/analytics/infrastructure/phonepe-pulse-repository';

function createMockDb(
  queryFn: (sql: string, params?: readonly unknown[]) => Promise<readonly unknown[]>,
): DatabaseClient {
  return {
    query: (async <T = unknown>(sql: string, params?: readonly unknown[]): Promise<readonly T[]> => {
      const rows = await queryFn(sql, params);
      return rows as unknown as readonly T[];
    }) as DatabaseClient['query'],
    execute: vi.fn(),
    transaction: vi.fn(),
    forTenant: vi.fn(),
  };
}

describe('PostgresPhonePePulseRepository', () => {
  it('aggregates national transaction trends chronologically', async () => {
    const mockDb = createMockDb(async (sql: string) => {
      if (sql.includes("dataset_type = 'transaction'")) {
        return [
          {
            year: 2024,
            quarter: 1,
            geo_name: 'india',
            parent_geo_name: null,
            segment: 'p2p',
            rank: null,
            transaction_count: 100,
            transaction_amount: null,
            registered_count: null,
          },
          {
            year: 2024,
            quarter: 1,
            geo_name: 'india',
            parent_geo_name: null,
            segment: 'retail',
            rank: null,
            transaction_count: 150,
            transaction_amount: null,
            registered_count: null,
          },
          {
            year: 2023,
            quarter: 4,
            geo_name: 'india',
            parent_geo_name: null,
            segment: 'p2p',
            rank: null,
            transaction_count: 200,
            transaction_amount: null,
            registered_count: null,
          },
        ];
      }
      return [];
    });

    const repo = new PostgresPhonePePulseRepository(mockDb);
    const trend = await repo.getNationalTrend();

    expect(trend).toEqual([
      { year: 2023, quarter: 4, transactionCount: 200 },
      { year: 2024, quarter: 1, transactionCount: 250 },
    ]);
  });

  it('ranks top states by transaction count', async () => {
    const mockDb = createMockDb(async () => [
      {
        year: 2024,
        quarter: 1,
        geo_name: 'Karnataka',
        parent_geo_name: null,
        segment: null,
        rank: null,
        transaction_count: 5000,
        transaction_amount: 100000,
        registered_count: null,
      },
      {
        year: 2024,
        quarter: 1,
        geo_name: 'Maharashtra',
        parent_geo_name: null,
        segment: null,
        rank: null,
        transaction_count: 8000,
        transaction_amount: 150000,
        registered_count: null,
      },
    ]);

    const repo = new PostgresPhonePePulseRepository(mockDb);
    const states = await repo.getTopStates(2024, 1, 5);

    expect(states[0].name).toBe('Maharashtra');
    expect(states[0].count).toBe(8000);
    expect(states[1].name).toBe('Karnataka');
    expect(states[1].count).toBe(5000);
  });

  it('calculates category breakdown shares deterministically', async () => {
    const mockDb = createMockDb(async () => [
      {
        year: 2024,
        quarter: 1,
        geo_name: 'india',
        parent_geo_name: null,
        segment: 'retail',
        rank: null,
        transaction_count: 7500,
        transaction_amount: null,
        registered_count: null,
      },
      {
        year: 2024,
        quarter: 1,
        geo_name: 'india',
        parent_geo_name: null,
        segment: 'p2p',
        rank: null,
        transaction_count: 2500,
        transaction_amount: null,
        registered_count: null,
      },
    ]);

    const repo = new PostgresPhonePePulseRepository(mockDb);
    const breakdown = await repo.getCategoryBreakdown(2024, 1);

    expect(breakdown).toHaveLength(2);
    expect(breakdown[0].category).toBe('retail');
    expect(breakdown[0].sharePct).toBe(75);
    expect(breakdown[1].category).toBe('p2p');
    expect(breakdown[1].sharePct).toBe(25);
  });

  it('assembles a full benchmark summary with comparisons', async () => {
    const mockDb = createMockDb(async (sql: string) => {
      if (
        sql.includes("dataset_type = 'transaction'") &&
        sql.includes("scope = 'country'") &&
        sql.includes("category = 'aggregated'")
      ) {
        return [
          { year: 2023, quarter: 1, transaction_count: 1000 },
          { year: 2023, quarter: 4, transaction_count: 1500 },
          { year: 2024, quarter: 1, transaction_count: 2000 },
        ];
      }
      if (sql.includes("dataset_type = 'user'")) {
        return [{ year: 2024, quarter: 1, registered_count: 50000 }];
      }
      if (sql.includes("geo_level = 'state'") && sql.includes("sum(transaction_amount)")) {
        return [{ total_amount: 9999999 }];
      }
      if (sql.includes("category = 'map'")) {
        return [
          {
            year: 2024,
            quarter: 1,
            geo_name: 'delhi',
            transaction_count: 2000,
            transaction_amount: 9999999,
          },
        ];
      }
      return [];
    });

    const repo = new PostgresPhonePePulseRepository(mockDb);
    const summary = await repo.getBenchmarkSummary();

    expect(summary.period).toEqual({ year: 2024, quarter: 1 });
    expect(summary.nationalMetrics.transactionCount).toBe(2000);
    expect(summary.nationalMetrics.registeredUsers).toBe(50000);
    expect(summary.nationalMetrics.transactionAmount).toBe(9999999);

    // QoQ comparison vs 2023 Q4 (1500) -> +500 (+33.33%)
    expect(summary.comparisons.quarterOverQuarter).toEqual({
      current: 2000,
      previous: 1500,
      change: 500,
      changePct: 33.33,
    });

    // YoY comparison vs 2023 Q1 (1000) -> +1000 (+100%)
    expect(summary.comparisons.yearOverYear).toEqual({
      current: 2000,
      previous: 1000,
      change: 1000,
      changePct: 100,
    });
  });
});
