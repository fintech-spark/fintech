import { describe, expect, it } from 'vitest';
import {
  CASH_FLOW_CATEGORY_LABELS,
  MIN_HISTORY_PERIODS,
  PostgresCashFlowService,
  applyRunningBalances,
  buildCashFlowPeriod,
  buildCoverage,
  calculateLowBalanceThreshold,
  calculateNetFlow,
  categoryForExpense,
  collectRisks,
  createBuckets,
  detectHighConcentration,
  detectLowBalance,
  detectNegativeBalance,
  detectPaymentSpike,
  distributeDatedItems,
  nextOccurrence,
  occurrencesInHorizon,
  projectCashFlow,
  scaleMeanToBucket,
  totalForCategory,
  type CashFlowInputs,
} from '@/modules/cash-flow';
import {
  InMemoryAnalyticsRepository,
  InMemoryCashFlowForecastStore,
  InMemoryCashFlowRepository,
  TENANT_A,
  TENANT_B,
  fixedClockAt,
  period,
  tenantFor,
  type LedgerExpense,
  type LedgerSale,
  type PayableFixture,
  type ReceivableFixture,
} from './support/doubles';

const HORIZON = period('2026-02-01T00:00:00.000Z', '2026-03-03T00:00:00.000Z');

function inputs(overrides: Partial<CashFlowInputs> = {}): CashFlowInputs {
  return {
    businessId: TENANT_A,
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    horizon: HORIZON,
    openingCashMinor: 0,
    openingBalanceSource: 'ledger_derived',
    receivables: [],
    payables: [],
    datedExpenses: [],
    recurringExpenses: [],
    historicalInflows: [],
    historicalWindowDays: 0,
    asOf: new Date('2026-02-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('net flow and balance arithmetic', () => {
  it('nets inflows against outflows', () => {
    expect(calculateNetFlow([{ amount: 500 }, { amount: 300 }], [{ amount: 700 }])).toBe(100);
  });

  it('is negative when only money leaves', () => {
    expect(calculateNetFlow([], [{ amount: 400 }])).toBe(-400);
  });

  it('is negative when only money arrives', () => {
    expect(calculateNetFlow([{ amount: 400 }], [])).toBe(400);
  });

  it('is zero for an empty horizon', () => {
    expect(calculateNetFlow([], [])).toBe(0);
  });

  it('carries the running balance forward without mutating its input', () => {
    const buckets = createBuckets([
      { from: new Date('2026-02-01'), to: new Date('2026-02-08') },
      { from: new Date('2026-02-08'), to: new Date('2026-02-15') },
    ]);
    buckets[0]!.outflows.push({
      category: 'operating_expenses',
      amount: 100,
      description: 'x',
      confidence: 'expected',
      assumptionBased: false,
    });
    const periods = applyRunningBalances(buckets.map(buildCashFlowPeriod), 1_000);
    expect(periods.map((period) => period.runningBalance)).toEqual([900, 900]);
    expect(buckets[0]!.outflows[0]?.amount).toBe(100);
  });

  it('sets the one-week outflow buffer as the low-balance threshold', () => {
    expect(calculateLowBalanceThreshold(100_000)).toBe(10_000);
  });

  it('makes the buffer inert when there is no outflow history', () => {
    expect(calculateLowBalanceThreshold(0)).toBe(0);
  });
});

describe('recurrence expansion', () => {
  it('advances by the stored frequency', () => {
    const base = new Date('2026-02-01T00:00:00.000Z');
    expect(nextOccurrence(base, 'daily')?.toISOString()).toBe('2026-02-02T00:00:00.000Z');
    expect(nextOccurrence(base, 'weekly')?.toISOString()).toBe('2026-02-08T00:00:00.000Z');
    expect(nextOccurrence(base, 'monthly')?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(nextOccurrence(base, 'quarterly')?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(nextOccurrence(base, 'yearly')?.toISOString()).toBe('2027-02-01T00:00:00.000Z');
  });

  it('clamps month arithmetic to the last valid day', () => {
    expect(nextOccurrence(new Date('2026-01-31T00:00:00.000Z'), 'monthly')?.toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
  });

  it('lists only occurrences inside the horizon', () => {
    const occurrences = occurrencesInHorizon(
      {
        id: 'rent-1',
        category: 'rent',
        amountMinor: 50_000,
        frequency: 'monthly',
        nextDueDate: new Date('2026-01-15T00:00:00.000Z'),
        endDate: null,
      },
      HORIZON,
    );
    // Jan 15 falls before the horizon, so the first in-horizon occurrence is Feb 15
    // and Mar 15 is past the end.
    expect(occurrences.map((date) => date.toISOString())).toEqual([
      '2026-02-15T00:00:00.000Z',
    ]);
  });

  it('stops at a recorded end date', () => {
    const occurrences = occurrencesInHorizon(
      {
        id: 'rent-1',
        category: 'rent',
        amountMinor: 50_000,
        frequency: 'monthly',
        nextDueDate: new Date('2026-01-15T00:00:00.000Z'),
        endDate: new Date('2026-02-15T00:00:00.000Z'),
      },
      HORIZON,
    );
    expect(occurrences).toHaveLength(1);
  });

  it('bounds a malformed daily recurrence so the engine cannot spin', () => {
    const occurrences = occurrencesInHorizon(
      {
        id: 'broken',
        category: 'other',
        amountMinor: 1,
        frequency: 'daily',
        nextDueDate: new Date('2026-02-01T00:00:00.000Z'),
        endDate: null,
      },
      { from: new Date('2026-02-01'), to: new Date('2099-01-01') },
    );
    expect(occurrences.length).toBeLessThanOrEqual(60);
  });
});

describe('obligation bucketing', () => {
  it('places each obligation in the bucket containing its due date', () => {
    const buckets = createBuckets([
      { from: new Date('2026-02-01'), to: new Date('2026-02-08') },
      { from: new Date('2026-02-08'), to: new Date('2026-02-15') },
    ]);
    distributeDatedItems(
      buckets,
      inputs({
        receivables: [
          {
            id: 'r1',
            counterpartyId: 'c1',
            counterpartyName: 'Asha',
            openMinor: 40_000,
            dueDate: new Date('2026-02-03'),
            daysOverdue: 0,
          },
        ],
        payables: [
          {
            id: 'p1',
            counterpartyId: 's1',
            counterpartyName: 'Supplier',
            openMinor: 30_000,
            dueDate: new Date('2026-02-10'),
            daysOverdue: 0,
          },
        ],
      }),
    );
    expect(buckets[0]!.inflows).toHaveLength(1);
    expect(buckets[1]!.outflows).toHaveLength(1);
  });

  it('keeps overdue money in the first bucket rather than dropping it', () => {
    const buckets = createBuckets([{ from: new Date('2026-02-01'), to: new Date('2026-02-15') }]);
    distributeDatedItems(
      buckets,
      inputs({
        receivables: [
          {
            id: 'r-old',
            counterpartyId: 'c1',
            counterpartyName: 'Asha',
            openMinor: 40_000,
            dueDate: new Date('2025-11-01'),
            daysOverdue: 62,
          },
        ],
      }),
    );
    expect(buckets[0]!.inflows).toHaveLength(1);
    expect(buckets[0]!.inflows[0]?.description).toContain('62 day(s) overdue');
  });

  it('ignores obligations due after the horizon', () => {
    const buckets = createBuckets([{ from: new Date('2026-02-01'), to: new Date('2026-02-08') }]);
    distributeDatedItems(
      buckets,
      inputs({
        payables: [
          {
            id: 'p-late',
            counterpartyId: 's1',
            counterpartyName: 'Supplier',
            openMinor: 30_000,
            dueDate: new Date('2026-09-01'),
            daysOverdue: 0,
          },
        ],
      }),
    );
    expect(buckets[0]!.outflows).toHaveLength(0);
  });

  it('flags only derived occurrences as assumption-based', () => {
    const buckets = createBuckets([{ from: new Date('2026-01-01'), to: new Date('2026-06-01') }]);
    distributeDatedItems(
      buckets,
      inputs({
        horizon: { from: new Date('2026-01-01'), to: new Date('2026-06-01') },
        recurringExpenses: [
          {
            id: 'rent-1',
            category: 'rent',
            amountMinor: 50_000,
            frequency: 'monthly',
            nextDueDate: new Date('2026-01-15'),
            endDate: null,
          },
        ],
      }),
    );
    // Jan 15, Feb 15, Mar 15, Apr 15, May 15 all fall inside Jan 1 - Jun 1.
    const items = buckets.flatMap((bucket) => bucket.outflows);
    expect(items).toHaveLength(5);
    // Only the first is read from a record; the rest are derived from the frequency.
    expect(items.filter((item) => item.assumptionBased)).toHaveLength(4);
  });

  it('maps expense categories onto cash-flow categories', () => {
    expect(categoryForExpense('salaries')).toBe('salaries');
    expect(categoryForExpense('rent')).toBe('rent');
    expect(categoryForExpense('taxes')).toBe('taxes');
    expect(categoryForExpense('marketing')).toBe('operating_expenses');
    expect(CASH_FLOW_CATEGORY_LABELS.collections).toBe('Customer collections');
  });
});

describe('forecast honesty', () => {
  function project(overrides: Partial<CashFlowInputs> = {}, openingCashMinor = 0) {
    const source = inputs(overrides);
    const buckets = createBuckets([
      { from: new Date('2026-02-01'), to: new Date('2026-02-08') },
      { from: new Date('2026-02-08'), to: new Date('2026-02-15') },
    ]);
    distributeDatedItems(buckets, source);
    return projectCashFlow({
      buckets,
      inputs: source,
      openingBalanceMinor: openingCashMinor,
      openingBalanceSource: source.openingBalanceSource,
    });
  }

  it('projects no sales line without enough history', () => {
    const projection = project();
    expect(projection.periods.flatMap((p) => p.inflows)).toHaveLength(0);
    expect(totalForCategory(projection.periods, 'sales_revenue')).toBe(0);
  });

  it('projects a sales line only past the minimum history, and marks it assumed', () => {
    const history = [0, 1, 2].map((index) => ({
      from: new Date(Date.UTC(2025, 8 + index, 1)),
      to: new Date(Date.UTC(2025, 9 + index, 1)),
      inflowMinor: 100_000,
    }));
    const projection = project({ historicalInflows: history });
    const items = projection.periods.flatMap((p) => p.inflows);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.confidence === 'projected')).toBe(true);
    expect(items.every((item) => item.assumptionBased)).toBe(true);
    expect(MIN_HISTORY_PERIODS).toBe(3);
  });

  it('always states at least one assumption', () => {
    const projection = project();
    expect(projection.assumptions.length).toBeGreaterThan(0);
  });

  it('lowers coverage when part of the projection is extrapolated', () => {
    const dated = project({
      receivables: [
        {
          id: 'r1',
          counterpartyId: 'c1',
          counterpartyName: 'Asha',
          openMinor: 100_000,
          dueDate: new Date('2026-02-03'),
          daysOverdue: 0,
        },
      ],
    });
    const mixed = project({
      receivables: [
        {
          id: 'r1',
          counterpartyId: 'c1',
          counterpartyName: 'Asha',
          openMinor: 100_000,
          dueDate: new Date('2026-02-03'),
          daysOverdue: 0,
        },
      ],
      historicalInflows: [0, 1, 2].map((index) => ({
        from: new Date(Date.UTC(2025, 8 + index, 1)),
        to: new Date(Date.UTC(2025, 9 + index, 1)),
        inflowMinor: 100_000,
      })),
    });
    expect(dated.coverage.coverageBps).toBe(10_000);
    expect(mixed.coverage.coverageBps).toBeLessThan(10_000);
  });

  it('reports insufficient data for a horizon with no obligations at all', () => {
    const projection = project();
    expect(projection.coverage.quality).toBe('insufficient_data');
    expect(projection.coverage.knownGaps.length).toBeGreaterThan(0);
  });

  it('marks the result as a projection and labels a ledger-derived opening balance', () => {
    const projection = project();
    expect(projection.openingBalanceMinor).toBe(0);
    expect(projection.coverage.knownGaps.join(' ')).toMatch(/not reconciled/i);
  });

  it('is deterministic: identical inputs produce an identical projection', () => {
    const first = project({ receivables: [
      { id: 'r1', counterpartyId: 'c1', counterpartyName: 'Asha', openMinor: 100_000, dueDate: new Date('2026-02-03'), daysOverdue: 0 },
    ] }, 250_000);
    const second = project({ receivables: [
      { id: 'r1', counterpartyId: 'c1', counterpartyName: 'Asha', openMinor: 100_000, dueDate: new Date('2026-02-03'), daysOverdue: 0 },
    ] }, 250_000);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('risk detection', () => {
  const bucket = { from: new Date('2026-02-01'), to: new Date('2026-02-08') };

  it('flags a negative projected balance as critical', () => {
    const buckets = createBuckets([bucket]);
    buckets[0]!.outflows.push({
      category: 'supplier_payments',
      amount: 200_000,
      description: 'x',
      confidence: 'expected',
      assumptionBased: false,
    });
    const risk = detectNegativeBalance(applyRunningBalances(buckets.map(buildCashFlowPeriod), 50_000)[0]!);
    expect(risk?.type).toBe('negative_balance');
    expect(risk?.severity).toBe('critical');
    expect(risk?.projectedShortfall).toBe(150_000);
  });

  it('does not flag a balance at exactly zero', () => {
    const buckets = createBuckets([bucket]);
    buckets[0]!.outflows.push({
      category: 'supplier_payments',
      amount: 50_000,
      description: 'x',
      confidence: 'expected',
      assumptionBased: false,
    });
    const risk = detectNegativeBalance(applyRunningBalances(buckets.map(buildCashFlowPeriod), 50_000)[0]!);
    expect(risk).toBeNull();
  });

  it('flags a balance below the buffer as a warning', () => {
    const period: ReturnType<typeof buildCashFlowPeriod> = {
      periodStart: bucket.from,
      periodEnd: bucket.to,
      inflows: [],
      outflows: [],
      netFlow: 0,
      runningBalance: 900,
    };
    const risk = detectLowBalance(period, 10_000);
    expect(risk?.severity).toBe('warning');
    expect(risk?.type).toBe('low_balance');
  });

  it('does not escalate a negative balance into a low-balance warning', () => {
    const period: ReturnType<typeof buildCashFlowPeriod> = {
      periodStart: bucket.from,
      periodEnd: bucket.to,
      inflows: [],
      outflows: [],
      netFlow: 0,
      runningBalance: -5,
    };
    expect(detectLowBalance(period, 10_000)).toBeNull();
  });

  it('flags an outflow spike against the median period', () => {
    const periods = [10_000, 10_000, 10_000, 90_000].map((amount, index) => ({
      periodStart: new Date(2026, 1, index + 1),
      periodEnd: new Date(2026, 1, index + 2),
      inflows: [],
      outflows: [
        { category: 'supplier_payments' as const, amount, description: 'x', confidence: 'expected' as const, assumptionBased: false },
      ],
      netFlow: -amount,
      runningBalance: 0,
    }));
    expect(detectPaymentSpike(periods)?.type).toBe('payment_spike');
  });

  it('does not flag ordinary variance as a spike', () => {
    const periods = [10_000, 10_000, 10_000, 15_000].map((amount, index) => ({
      periodStart: new Date(2026, 1, index + 1),
      periodEnd: new Date(2026, 1, index + 2),
      inflows: [],
      outflows: [
        { category: 'supplier_payments' as const, amount, description: 'x', confidence: 'expected' as const, assumptionBased: false },
      ],
      netFlow: -amount,
      runningBalance: 0,
    }));
    expect(detectPaymentSpike(periods)).toBeNull();
  });

  it('flags one counterparty holding over half the exposure', () => {
    const risk = detectHighConcentration(
      [
        { id: 'r1', counterpartyId: 'c1', counterpartyName: 'Big', openMinor: 80_000, dueDate: new Date('2026-02-03'), daysOverdue: 0 },
        { id: 'r2', counterpartyId: 'c2', counterpartyName: 'Small', openMinor: 20_000, dueDate: new Date('2026-02-04'), daysOverdue: 0 },
      ],
      100_000,
      'inflow',
    );
    expect(risk?.type).toBe('high_concentration');
    expect(risk?.relatedIds).toEqual(['r1']);
  });

  it('does not flag an evenly spread exposure', () => {
    expect(
      detectHighConcentration(
        [
          { id: 'r1', counterpartyId: 'c1', counterpartyName: 'A', openMinor: 50_000, dueDate: new Date(), daysOverdue: 0 },
          { id: 'r2', counterpartyId: 'c2', counterpartyName: 'B', openMinor: 50_000, dueDate: new Date(), daysOverdue: 0 },
        ],
        100_000,
        'inflow',
      ),
    ).toBeNull();
  });

  it('orders risks by severity', () => {
    const risks = collectRisks({
      periods: [
        {
          periodStart: new Date('2026-02-08'),
          periodEnd: new Date('2026-02-15'),
          inflows: [],
          outflows: [],
          netFlow: 0,
          runningBalance: -100,
        },
      ],
      receivables: [],
      payables: [],
      averageMonthlyOutflowMinor: 0,
      openingBalanceSource: 'unavailable',
    });
    expect(risks[0]?.severity).toBe('critical');
  });
});

describe('coverage scoring', () => {
  it('reports zero coverage rather than NaN for an empty projection', () => {
    const coverage = buildCoverage({ items: [], periodsOfHistory: 0, historicalWindowDays: 0 });
    expect(coverage.coverageBps).toBe(0);
    expect(coverage.hasEnoughHistory).toBe(false);
    expect(coverage.quality).toBe('insufficient_data');
  });

  it('reports full coverage when every line is backed by a dated record', () => {
    const coverage = buildCoverage({
      items: [
        { category: 'collections', amount: 100, description: 'x', confidence: 'expected', assumptionBased: false },
      ],
      periodsOfHistory: 4,
      historicalWindowDays: 120,
    });
    expect(coverage.coverageBps).toBe(10_000);
  });
});

describe('bucket scaling', () => {
  it('scales a historical mean down when the bucket is shorter than the history period', () => {
    // 70,000 over a 30-day month is 2,333/day; a 14-day bucket is therefore ~32,667.
    const scaled = scaleMeanToBucket(
      70_000,
      { from: new Date('2026-02-01'), to: new Date('2026-02-15') },
      [{ from: new Date('2026-01-01'), to: new Date('2026-01-31') }],
    );
    expect(scaled).toBe(32_667);
  });

  it('scales a historical mean up when the bucket is longer than the history period', () => {
    const scaled = scaleMeanToBucket(
      30_000,
      { from: new Date('2026-02-01'), to: new Date('2026-03-01') },
      [{ from: new Date('2026-01-01'), to: new Date('2026-01-15') }],
    );
    expect(scaled).toBe(60_000);
  });

  it('returns zero when there is no history to scale from', () => {
    expect(
      scaleMeanToBucket(70_000, { from: new Date('2026-02-01'), to: new Date('2026-02-15') }, []),
    ).toBe(0);
  });
});

describe('cash-flow service over a synthetic ledger', () => {
  const sales: readonly LedgerSale[] = [
    {
      businessId: TENANT_A,
      at: '2026-01-10T00:00:00Z',
      type: 'sale',
      status: 'completed',
      subtotalMinor: 500_000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 500_000,
    },
  ];
  const expenses: readonly LedgerExpense[] = [
    { businessId: TENANT_A, at: '2026-01-11T00:00:00Z', category: 'rent', amountMinor: 60_000, status: 'paid' },
  ];
  const receivables: readonly ReceivableFixture[] = [
    {
      businessId: TENANT_A,
      id: 'r1',
      customerId: 'c1',
      customerName: 'Asha',
      amountMinor: 120_000,
      paidMinor: 0,
      dueDate: '2026-02-10T00:00:00Z',
      status: 'pending',
    },
  ];
  const payables: readonly PayableFixture[] = [
    {
      businessId: TENANT_A,
      id: 'p1',
      supplierId: 's1',
      supplierName: 'Supplier',
      amountMinor: 300_000,
      paidMinor: 0,
      dueDate: '2026-02-05T00:00:00Z',
      status: 'pending',
    },
  ];

  function build() {
    const analytics = new InMemoryAnalyticsRepository({
      sales,
      expenses,
      products: [],
      receivables,
      payables,
    });
    return {
      analytics,
      service: new PostgresCashFlowService(
        new InMemoryCashFlowRepository(analytics),
        new InMemoryCashFlowForecastStore(),
        fixedClockAt('2026-02-01T00:00:00.000Z'),
      ),
    };
  }

  it('projects collections and supplier payments into the horizon', async () => {
    const { service } = build();
    const forecast = await service.forecast(tenantFor(TENANT_A), HORIZON);
    expect(forecast.isProjection).toBe(true);
    expect(forecast.assumptions.length).toBeGreaterThan(0);
    expect(forecast.coverage.quality).not.toBe('insufficient_data');
    expect(totalForCategory(forecast.periods, 'collections')).toBe(120_000);
    expect(totalForCategory(forecast.periods, 'supplier_payments')).toBe(300_000);
  });

  it('never returns another tenant', async () => {
    const { service } = build();
    const forecast = await service.forecast(tenantFor(TENANT_B), HORIZON);
    expect(totalForCategory(forecast.periods, 'collections')).toBe(0);
    expect(totalForCategory(forecast.periods, 'supplier_payments')).toBe(0);
  });

  it('reports no risks when there are none rather than inventing one', async () => {
    const { service } = build();
    expect(await service.getRisks(tenantFor(TENANT_A))).toEqual([]);
  });

  it('returns null for a stored forecast that does not exist', async () => {
    const { service } = build();
    expect(await service.getLatestForecast(tenantFor(TENANT_A))).toBeNull();
    expect(await service.getForecastById(tenantFor(TENANT_A), 'missing')).toBeNull();
  });

  it('clamps an over-long horizon instead of projecting indefinitely', async () => {
    const { service } = build();
    const forecast = await service.forecast(
      tenantFor(TENANT_A),
      period('2026-02-01T00:00:00Z', '2030-01-01T00:00:00Z'),
    );
    expect(forecast.period.to.getTime()).toBeLessThanOrEqual(
      new Date('2026-02-01T00:00:00Z').getTime() + 400 * 86_400_000,
    );
  });

  it('summarises near-term obligations with the projection caveat attached', async () => {
    const { service } = build();
    const obligations = await service.getUpcomingObligations(tenantFor(TENANT_A), 30);
    expect(obligations.isProjection).toBe(true);
    expect(obligations.expectedInflows).toBe(120_000);
    expect(obligations.expectedOutflows).toBe(300_000);
    expect(obligations.netExpected).toBe(-180_000);
    expect(obligations.coverageNote).toMatch(/not guaranteed/i);
  });
});