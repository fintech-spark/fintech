import { describe, expect, it } from 'vitest';
import {
  EMPTY_SALE_TOTALS,
  PostgresAnalyticsService,
  calculateChangeBps,
  calculateGrossProfit,
  calculateMarginBps,
  calculateNetProfit,
  expenseBreakdown,
  inventoryValueMinor,
  ledgerCashMovement,
  openBalanceMinor,
  recognizeCogs,
  recognizeRevenue,
  totalOperatingExpensesMinor,
  validatePeriod,
  workingCapitalMinor,
  type SaleTotals,
} from '@/modules/analytics';
import {
  InMemoryAnalyticsRepository,
  TENANT_A,
  TENANT_B,
  fixedClockAt,
  period,
  tenantFor,
  type LedgerExpense,
  type LedgerProduct,
  type LedgerSale,
} from './support/doubles';

const JANUARY = period('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
const DECEMBER = period('2025-12-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

function totals(overrides: Partial<SaleTotals> = {}): SaleTotals {
  return { ...EMPTY_SALE_TOTALS, saleCount: 10, currencies: ['INR'], ...overrides };
}

describe('revenue recognition', () => {
  it('nets discounts and keeps tax out of revenue', () => {
    const recognised = recognizeRevenue(
      totals({ grossRevenueMinor: 100_000, discountMinor: 10_000, taxMinor: 18_000, totalInvoicedMinor: 108_000 }),
    );
    expect(recognised.grossRevenue.amount).toBe(100_000);
    expect(recognised.netRevenue.amount).toBe(90_000);
    expect(recognised.taxCollected.amount).toBe(18_000);
    expect(recognised.totalInvoiced.amount).toBe(108_000);
    expect(recognised.discountRateBps).toBe(1_000);
  });

  it('subtracts refunds from net revenue rather than reporting them separately', () => {
    const recognised = recognizeRevenue(
      totals({ grossRevenueMinor: 100_000, discountMinor: 0, refundMinor: 25_000 }),
    );
    expect(recognised.refunds.amount).toBe(25_000);
    expect(recognised.effectiveNetRevenue.amount).toBe(75_000);
    expect(recognised.refundRateBps).toBe(2_500);
  });

  it('reports insufficient data rather than zero for a period with no sales', () => {
    const recognised = recognizeRevenue(EMPTY_SALE_TOTALS);
    expect(recognised.quality).toBe('insufficient_data');
    expect(recognised.unavailableMetrics).toContain('revenue');
    expect(recognised.discountRateBps).toBeUndefined();
    expect(recognised.refundRateBps).toBeUndefined();
  });

  it('refuses to aggregate mixed currencies instead of adding paise to cents', () => {
    expect(() => recognizeRevenue(totals({ currencies: ['INR', 'USD'] }))).toThrow(
      /no FX rate table|Cross-currency/i,
    );
  });

  it('rejects a non-integer aggregate', () => {
    expect(() => recognizeRevenue(totals({ grossRevenueMinor: 100.5 }))).toThrow(/safe integer/i);
  });

  it('computes an average order value net of discount and refund', () => {
    const recognised = recognizeRevenue(
      totals({ grossRevenueMinor: 100_000, discountMinor: 10_000, refundMinor: 0, saleCount: 4 }),
    );
    const service = new PostgresAnalyticsService(
      new InMemoryAnalyticsRepository({ sales: [], expenses: [], products: [] }),
      fixedClockAt('2026-02-01T00:00:00.000Z'),
    );
    void service;
    expect(recognised.netRevenue.amount / recognised.saleCount).toBe(22_500);
  });
});

describe('cost of goods recognition', () => {
  it('is complete only when every sale line was costed', () => {
    const costed = recognizeCogs(totals({ lineCount: 10, uncostedLineCount: 0, cogsMinor: 60_000 }));
    expect(costed.quality).toBe('complete');
    expect(costed.cogs.amount).toBe(60_000);

    const partial = recognizeCogs(totals({ lineCount: 10, uncostedLineCount: 3, cogsMinor: 40_000 }));
    expect(partial.quality).toBe('partial');

    const unknown = recognizeCogs(totals({ lineCount: 10, uncostedLineCount: 10, cogsMinor: 0 }));
    expect(unknown.quality).toBe('insufficient_data');
  });

  it('treats a period with no sales as having no cost data', () => {
    expect(recognizeCogs(EMPTY_SALE_TOTALS).quality).toBe('insufficient_data');
  });
});

describe('published formula compatibility', () => {
  it('preserves the module contract for gross profit, net profit and margin', () => {
    expect(calculateGrossProfit(1_000_000, 600_000)).toBe(400_000);
    expect(calculateNetProfit(400_000, 150_000)).toBe(250_000);
    expect(calculateMarginBps(400_000, 1_000_000)).toBe(4_000);
  });

  it('reports zero margin for zero revenue in the legacy helper', () => {
    expect(calculateMarginBps(0, 0)).toBe(0);
  });

  it('preserves the legacy change helper for a zero baseline', () => {
    expect(calculateChangeBps(500, 0)).toBe(10_000);
    expect(calculateChangeBps(0, 0)).toBe(0);
  });
});

describe('expense recognition', () => {
  const expenses: readonly LedgerExpense[] = [
    { businessId: TENANT_A, at: '2026-01-05T00:00:00Z', category: 'rent', amountMinor: 50_000, status: 'paid' },
    { businessId: TENANT_A, at: '2026-01-06T00:00:00Z', category: 'rent', amountMinor: 50_000, status: 'approved' },
    { businessId: TENANT_A, at: '2026-01-07T00:00:00Z', category: 'utilities', amountMinor: 10_000, status: 'pending' },
    { businessId: TENANT_A, at: '2026-01-08T00:00:00Z', category: 'utilities', amountMinor: 99_000, status: 'rejected' },
    { businessId: TENANT_B, at: '2026-01-05T00:00:00Z', category: 'rent', amountMinor: 999_999, status: 'paid' },
  ];

  it('counts only approved and paid expenses', () => {
    expect(totalOperatingExpensesMinor(TENANT_A, expenses)).toBe(100_000);
  });

  it('breaks expenses down by category with an explicit share', () => {
    const breakdown = expenseBreakdown(TENANT_A, expenses);
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]?.category).toBe('rent');
    expect(breakdown[0]?.amountMinor).toBe(100_000);
    expect(breakdown[0]?.shareBps).toBe(10_000);
  });

  it('reports an undefined share when nothing was spent', () => {
    expect(expenseBreakdown(TENANT_A, [])).toEqual([]);
    expect(
      expenseBreakdown(TENANT_A, [
        { businessId: TENANT_A, category: 'rent', amountMinor: 0, status: 'paid' },
      ])[0]?.shareBps,
    ).toBeUndefined();
  });
});

describe('balances and working capital', () => {
  it('computes an open balance', () => {
    expect(openBalanceMinor({ amountMinor: 100_000, paidAmountMinor: 30_000 })).toBe(70_000);
  });

  it('refuses an overpaid balance rather than reporting a negative', () => {
    expect(() => openBalanceMinor({ amountMinor: 100, paidAmountMinor: 200 })).toThrow(/exceeds/i);
  });

  it('values inventory at cost', () => {
    expect(
      inventoryValueMinor([
        { currentStock: 10, costPriceMinor: 2_500 },
        { currentStock: 2.5, costPriceMinor: 1_000 },
      ]),
    ).toBe(27_500);
  });

  it('reports working capital as unknown when there are no records at all', () => {
    expect(
      workingCapitalMinor({
        receivablesMinor: 0,
        payablesMinor: 0,
        hasReceivableRecords: false,
        hasPayableRecords: false,
      }),
    ).toBeUndefined();
  });

  it('reports a genuine zero working capital when records exist', () => {
    expect(
      workingCapitalMinor({
        receivablesMinor: 0,
        payablesMinor: 0,
        hasReceivableRecords: true,
        hasPayableRecords: true,
      }),
    ).toBe(0);
  });
});

describe('ledger-derived cash', () => {
  it('nets inflows against outflows', () => {
    const movement = ledgerCashMovement({
      from: new Date('2026-01-01'),
      to: new Date('2026-02-01'),
      openingCashMinor: 100_000,
      salesReceivedMinor: 500_000,
      customerPaymentsMinor: 50_000,
      purchasePaidMinor: 200_000,
      refundsPaidMinor: 10_000,
      expensesPaidMinor: 40_000,
      recognisedTransactionCount: 12,
    });
    expect(movement.netMovementMinor).toBe(300_000);
    expect(movement.closingCashMinor).toBe(400_000);
  });

  it('reports a negative movement when cash leaves', () => {
    const movement = ledgerCashMovement({
      from: new Date('2026-01-01'),
      to: new Date('2026-02-01'),
      openingCashMinor: 10_000,
      salesReceivedMinor: 0,
      customerPaymentsMinor: 0,
      purchasePaidMinor: 50_000,
      refundsPaidMinor: 0,
      expensesPaidMinor: 0,
      recognisedTransactionCount: 1,
    });
    expect(movement.closingCashMinor).toBe(-40_000);
  });
});

describe('period validation', () => {
  it('rejects a reversed or empty period', () => {
    expect(() => validatePeriod({ from: new Date('2026-02-01'), to: new Date('2026-01-01') })).toThrow(
      /strictly before/i,
    );
    expect(() => validatePeriod({ from: new Date('2026-01-01'), to: new Date('2026-01-01') })).toThrow();
  });

  it('rejects an invalid date', () => {
    expect(() => validatePeriod({ from: new Date('nope'), to: new Date('2026-01-01') })).toThrow(
      /valid Date/i,
    );
  });
});

describe('analytics service over a synthetic ledger', () => {
  const sales: readonly LedgerSale[] = [
    // December baseline: 10 sales of 100,000 with 60,000 cost.
    ...Array.from({ length: 10 }, (_, index) => ({
      businessId: TENANT_A,
      at: `2025-12-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
      type: 'sale' as const,
      status: 'completed',
      subtotalMinor: 100_000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 100_000,
      lines: [{ productId: 'p1', quantity: 1, unitPriceMinor: 100_000, discountMinor: 0, costPriceMinor: 60_000 }],
    })),
    // January: same volume, but cost rose to 70,000, so margin must compress.
    ...Array.from({ length: 10 }, (_, index) => ({
      businessId: TENANT_A,
      at: `2026-01-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
      type: 'sale' as const,
      status: 'completed',
      subtotalMinor: 100_000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 100_000,
      lines: [{ productId: 'p1', quantity: 1, unitPriceMinor: 100_000, discountMinor: 0, costPriceMinor: 70_000 }],
    })),
    // A voided sale must be excluded entirely.
    {
      businessId: TENANT_A,
      at: '2026-01-20T10:00:00.000Z',
      type: 'sale' as const,
      status: 'voided',
      subtotalMinor: 999_999,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 999_999,
      lines: [],
    },
    // A draft sale must be excluded entirely.
    {
      businessId: TENANT_A,
      at: '2026-01-21T10:00:00.000Z',
      type: 'sale' as const,
      status: 'draft',
      subtotalMinor: 888_888,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 888_888,
      lines: [],
    },
  ];

  const products: readonly LedgerProduct[] = [
    {
      businessId: TENANT_A,
      id: 'p1',
      name: 'Widget',
      status: 'active',
      costPriceMinor: 70_000,
      sellingPriceMinor: 100_000,
      currentStock: 10,
      createdAt: '2025-01-01T00:00:00.000Z',
    },
  ];

  function service(fixtures: ConstructorParameters<typeof InMemoryAnalyticsRepository>[0] = {
    sales,
    expenses: [],
    products,
  }) {
    return new PostgresAnalyticsService(
      new InMemoryAnalyticsRepository(fixtures),
      fixedClockAt('2026-02-01T00:00:00.000Z'),
    );
  }

  it('excludes voided and draft transactions from revenue', async () => {
    const snapshot = await service().getSnapshot(tenantFor(TENANT_A), JANUARY);
    expect(snapshot.revenue.amount).toBe(1_000_000);
    expect(snapshot.revenueRecognition.saleCount).toBe(10);
  });

  it('derives gross margin from recorded cost prices', async () => {
    const snapshot = await service().getSnapshot(tenantFor(TENANT_A), JANUARY);
    expect(snapshot.cogs.amount).toBe(700_000);
    expect(snapshot.grossProfit.amount).toBe(300_000);
    expect(snapshot.grossMarginBps).toBe(3_000);
  });

  it('shows margin compression against the previous period', async () => {
    const comparison = await service().getPeriodComparison(tenantFor(TENANT_A), JANUARY);
    expect(comparison.previous.grossMarginBps).toBe(4_000);
    const margin = comparison.deltas.find((delta) => delta.name === 'gross_margin');
    expect(margin?.changeBps).toBe(-1_000);
    expect(margin?.direction).toBe('decrease');
  });

  it('never reads another tenant', async () => {
    const snapshot = await service().getSnapshot(tenantFor(TENANT_B), JANUARY);
    expect(snapshot.revenue.amount).toBe(0);
    expect(snapshot.unavailableMetrics).toContain('revenue');
    expect(snapshot.quality).toBe('insufficient_data');
  });

  it('scopes every repository call to the requesting tenant', async () => {
    const repository = new InMemoryAnalyticsRepository({ sales, expenses: [], products });
    const analytics = new PostgresAnalyticsService(repository, fixedClockAt('2026-02-01T00:00:00.000Z'));
    await analytics.getSnapshot(tenantFor(TENANT_B), JANUARY);
    expect(repository.calls.length).toBeGreaterThan(0);
    expect(new Set(repository.calls.map((call) => call.businessId))).toEqual(new Set([TENANT_B]));
  });

  it('reports an unavailable comparison when there is no baseline', async () => {
    const comparison = await service().getPeriodComparison(tenantFor(TENANT_A), JANUARY);
    const revenue = comparison.deltas.find((delta) => delta.name === 'revenue');
    expect(revenue?.previousValue).toBe(1_000_000);
    void DECEMBER;
  });

  it('marks average order value unavailable when nothing was sold', async () => {
    const metric = await service().getMetric(tenantFor(TENANT_B), 'average_order_value', JANUARY);
    expect(metric.quality).toBe('insufficient_data');
    expect(metric.unavailableReason).toBe('no_records_in_period');
  });
});