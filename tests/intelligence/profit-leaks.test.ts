import { describe, expect, it } from 'vitest';
import {
  ABNORMAL_EXPENSE_MULTIPLIER,
  DEAD_INVENTORY_DAYS,
  DEAD_INVENTORY_MIN_VALUE_MINOR,
  DETECTORS,
  DISCOUNT_RATE_FLOOR_BPS,
  FORMULAS,
  DISCOUNT_RATE_RISE_BPS,
  LOW_MARGIN_FLOOR_BPS,
  MARGIN_COMPRESSION_BPS,
  MIN_SAMPLE_SIZE,
  PostgresProfitLeakService,
  SUPPLIER_COST_INCREASE_BPS,
  UNAVAILABLE_DETECTORS,
  abnormalExpenseImpact,
  classifySeverity,
  deadInventoryValueMinor,
  excessiveDiscountImpact,
  hasMinimumEvidence,
  impactPeriodLabel,
  isProductMature,
  lowMarginImpact,
  marginCompressionImpact,
  supplierCostIncreaseImpact,
  suppressionReason,
} from '@/modules/profit-leaks';
import {
  InMemoryAnalyticsRepository,
  TENANT_A,
  TENANT_B,
  fixedClockAt,
  period,
  tenantFor,
  type LedgerSale,
} from './support/doubles';
import {
  InMemoryProfitLeakRepository,
} from './support/action-doubles';
import { createEventBus } from '@/lib/events';
import { NotFoundError } from '@/lib/errors';
import { PostgresAnalyticsService } from '@/modules/analytics';

const JANUARY = period('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
const DECEMBER = period('2025-12-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
const NOW = '2026-02-01T00:00:00.000Z';

function sale(overrides: Partial<LedgerSale> & { at: string }): LedgerSale {
  return {
    businessId: TENANT_A,
    type: 'sale',
    status: 'completed',
    subtotalMinor: 100_000,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 100_000,
    lines: [],
    ...overrides,
  };
}

describe('published severity bands', () => {
  it('classifies by monthly impact in minor units', () => {
    expect(classifySeverity(5_000_000)).toBe('critical');
    expect(classifySeverity(4_999_999)).toBe('high');
    expect(classifySeverity(1_000_000)).toBe('high');
    expect(classifySeverity(999_999)).toBe('medium');
    expect(classifySeverity(200_000)).toBe('medium');
    expect(classifySeverity(199_999)).toBe('low');
    expect(classifySeverity(0)).toBe('low');
  });

  it('requires three evidence items for aggregate claims and one otherwise', () => {
    expect(hasMinimumEvidence(3, 'margin_compression')).toBe(true);
    expect(hasMinimumEvidence(2, 'margin_compression')).toBe(false);
    expect(hasMinimumEvidence(3, 'abnormal_expenses')).toBe(true);
    expect(hasMinimumEvidence(2, 'abnormal_expenses')).toBe(false);
    expect(hasMinimumEvidence(1, 'dead_inventory')).toBe(true);
    expect(hasMinimumEvidence(0, 'dead_inventory')).toBe(false);
  });
});

describe('detection arithmetic', () => {
  it('measures gross profit lost to margin compression', () => {
    // Baseline margin 4000 bps on 100,000 revenue implies 40,000 gross profit.
    expect(
      marginCompressionImpact({
        currentRevenueMinor: 100_000,
        currentGrossProfitMinor: 20_000,
        baselineMarginBps: 4_000,
      }),
    ).toBe(20_000);
  });

  it('reports no compression loss when margin improved', () => {
    expect(
      marginCompressionImpact({
        currentRevenueMinor: 100_000,
        currentGrossProfitMinor: 50_000,
        baselineMarginBps: 4_000,
      }),
    ).toBe(0);
  });

  it('measures discount given away beyond the baseline rate', () => {
    expect(
      excessiveDiscountImpact({
        currentGrossRevenueMinor: 100_000,
        currentDiscountMinor: 20_000,
        baselineDiscountRateBps: 1_000,
      }),
    ).toBe(10_000);
  });

  it('reports no discount leak when discounting fell', () => {
    expect(
      excessiveDiscountImpact({
        currentGrossRevenueMinor: 100_000,
        currentDiscountMinor: 5_000,
        baselineDiscountRateBps: 2_000,
      }),
    ).toBe(0);
  });

  it('scales a supplier price rise by the quantity actually sold', () => {
    expect(
      supplierCostIncreaseImpact({
        currentWeightedUnitPriceMinor: 110,
        baselineWeightedUnitPriceMinor: 100,
        quantitySold: 10,
      }),
    ).toBe(100);
  });

  it('reports no cost leak when the price fell', () => {
    expect(
      supplierCostIncreaseImpact({
        currentWeightedUnitPriceMinor: 90,
        baselineWeightedUnitPriceMinor: 100,
        quantitySold: 10,
      }),
    ).toBe(0);
  });

  it('measures the shortfall of a thin-margin product against the floor', () => {
    // 100 units of 1000 selling at 960 cost = 40/unit margin against a 50/unit floor.
    expect(lowMarginImpact({ unitMarginMinor: 40, floorMarginMinor: 50, quantitySold: 100 })).toBe(1_000);
  });

  it('reports no shortfall for a product above the floor', () => {
    expect(lowMarginImpact({ unitMarginMinor: 80, floorMarginMinor: 50, quantitySold: 100 })).toBe(0);
  });

  it('values idle stock at cost', () => {
    expect(deadInventoryValueMinor({ currentStock: 10, costPriceMinor: 30_000 })).toBe(300_000);
    expect(deadInventoryValueMinor({ currentStock: 0, costPriceMinor: 30_000 })).toBe(0);
  });

  it('measures excess category spend', () => {
    expect(abnormalExpenseImpact({ currentMinor: 150_000, baselineMinor: 100_000 })).toBe(50_000);
    expect(abnormalExpenseImpact({ currentMinor: 50_000, baselineMinor: 100_000 })).toBe(0);
  });

  it('gates product-level rules on product age', () => {
    expect(isProductMature({ createdAt: new Date('2025-06-01'), asOf: new Date(NOW) })).toBe(true);
    expect(isProductMature({ createdAt: new Date('2026-01-28'), asOf: new Date(NOW) })).toBe(false);
  });

  it('labels an impact period with an inclusive end date', () => {
    expect(impactPeriodLabel(new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'))).toBe(
      '2026-01-01 -> 2026-01-31',
    );
  });
});

describe('false-positive control', () => {
  it('suppresses when the current sample is too small', () => {
    const gate = suppressionReason({
      currentSampleSize: 2,
      baselineSampleSize: 20,
      observed: 100,
      baseline: 50,
      threshold: 1,
      thresholdKind: 'at_least',
    });
    expect(gate?.reason).toBe('insufficient_sample_size');
    expect(gate?.explanation).toContain(String(MIN_SAMPLE_SIZE));
  });

  it('suppresses when the baseline sample is too small', () => {
    const gate = suppressionReason({
      currentSampleSize: 20,
      baselineSampleSize: 3,
      observed: 100,
      baseline: 50,
      threshold: 1,
      thresholdKind: 'at_least',
    });
    expect(gate?.reason).toBe('insufficient_sample_size');
  });

  it('suppresses when there is no baseline period', () => {
    const gate = suppressionReason({
      currentSampleSize: 20,
      baselineSampleSize: 20,
      observed: 100,
      baseline: undefined,
      threshold: 1,
      thresholdKind: 'at_least',
    });
    expect(gate?.reason).toBe('no_baseline_period');
  });

  it('suppresses a percentage change against a zero baseline', () => {
    const gate = suppressionReason({
      currentSampleSize: 20,
      baselineSampleSize: 20,
      observed: 100,
      baseline: 0,
      threshold: 1,
      thresholdKind: 'at_least',
    });
    expect(gate?.reason).toBe('zero_baseline');
  });

  it('suppresses when the deviation is below the threshold', () => {
    const gate = suppressionReason({
      currentSampleSize: 20,
      baselineSampleSize: 20,
      observed: 100,
      baseline: 99,
      threshold: 1.5,
      thresholdKind: 'multiple',
    });
    expect(gate?.reason).toBe('threshold_not_met');
  });

  it('allows a detector through once its threshold is met', () => {
    expect(
      suppressionReason({
        currentSampleSize: 20,
        baselineSampleSize: 20,
        observed: 200,
        baseline: 100,
        threshold: 1.5,
        thresholdKind: 'multiple',
      }),
    ).toBeNull();
  });

  it('supports a negative threshold for a fall', () => {
    expect(
      suppressionReason({
        currentSampleSize: 20,
        baselineSampleSize: 20,
        observed: 2_000,
        baseline: 4_000,
        threshold: MARGIN_COMPRESSION_BPS,
        thresholdKind: 'fall_by_at_least',
      }),
    ).toBeNull();
    expect(
      suppressionReason({
        currentSampleSize: 20,
        baselineSampleSize: 20,
        observed: 3_900,
        baseline: 4_000,
        threshold: MARGIN_COMPRESSION_BPS,
        thresholdKind: 'fall_by_at_least',
      })?.reason,
    ).toBe('threshold_not_met');
  });
});

describe('declared thresholds', () => {
  it('exposes every threshold this implementation defined', () => {
    expect(MARGIN_COMPRESSION_BPS).toBe(200);
    expect(SUPPLIER_COST_INCREASE_BPS).toBe(500);
    expect(DISCOUNT_RATE_FLOOR_BPS).toBe(1_000);
    expect(DISCOUNT_RATE_RISE_BPS).toBe(500);
    expect(DEAD_INVENTORY_DAYS).toBe(90);
    expect(DEAD_INVENTORY_MIN_VALUE_MINOR).toBe(200_000);
    expect(LOW_MARGIN_FLOOR_BPS).toBe(500);
    expect(ABNORMAL_EXPENSE_MULTIPLIER).toBe(1.5);
  });

  it('runs every detector category the schema allows', () => {
    expect(DETECTORS).toHaveLength(8);
    expect(new Set(DETECTORS.map((detector) => detector.category)).size).toBe(8);
  });

  it('documents the arithmetic for every detector rule', () => {
    for (const detector of DETECTORS) {
      expect(FORMULAS[detector.category], `no formula for ${detector.category}`).toBeTruthy();
    }
  });

  it('gives every detector a non-empty rule description', () => {
    for (const detector of DETECTORS) {
      expect(detector.rule.length).toBeGreaterThan(10);
    }
  });

  it('declares the detector that the schema cannot support, rather than skipping it', () => {
    expect(UNAVAILABLE_DETECTORS).toHaveLength(1);
    expect(UNAVAILABLE_DETECTORS[0]?.category).toBe('high_payment_fees');
    expect(UNAVAILABLE_DETECTORS[0]?.requiredData.length).toBeGreaterThan(0);
  });
});

describe('detection service over a synthetic ledger', () => {
  it('detects margin compression with structured evidence', async () => {
    const december = Array.from({ length: 12 }, (_, index) =>
      sale({
        at: `2025-12-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
        lines: [{ productId: 'p1', quantity: 1, unitPriceMinor: 100_000, discountMinor: 0, costPriceMinor: 60_000 }],
      }),
    );
    const january = Array.from({ length: 12 }, (_, index) =>
      sale({
        at: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
        lines: [{ productId: 'p1', quantity: 1, unitPriceMinor: 100_000, discountMinor: 0, costPriceMinor: 80_000 }],
      }),
    );
    const analytics = new InMemoryAnalyticsRepository({ sales: [...december, ...january], expenses: [], products: [] });
    const repository = new InMemoryProfitLeakRepository();
    const analyticsService = new PostgresAnalyticsService(analytics, fixedClockAt(NOW));
    const service = new PostgresProfitLeakService(repository, analyticsService, fixedClockAt(NOW));

    const report = await service.analyze(tenantFor(TENANT_A), JANUARY);
    const leak = report.detected.find((entry) => entry.category === 'margin_compression');
    expect(leak).toBeDefined();
    expect(leak?.evidence.length).toBeGreaterThanOrEqual(3);
    expect(leak?.calculation.baselineValue).toBe(4_000);
    expect(leak?.calculation.observedValue).toBe(2_000);
    expect(leak?.calculation.rule).toBe('margin_compression');
    expect(leak?.calculation.formula).toContain('baselineGrossMarginBps');
    expect(leak?.calculation.ruleDescription).toMatch(/200 bps/);
    expect(leak?.impact.amount).toBeGreaterThan(0);
    expect(leak?.relatedRecordIds.length).toBeGreaterThan(0);
  });

  it('suppresses every detector for a merchant with no transactions', async () => {
    const analytics = new InMemoryAnalyticsRepository({ sales: [], expenses: [], products: [] });
    const repository = new InMemoryProfitLeakRepository();
    const analyticsService = new PostgresAnalyticsService(analytics, fixedClockAt(NOW));
    const service = new PostgresProfitLeakService(repository, analyticsService, fixedClockAt(NOW));

    const report = await service.analyze(tenantFor(TENANT_A), JANUARY);
    expect(report.detected).toHaveLength(0);
    expect(report.quality).toBe('insufficient_data');
    expect(report.suppressed.length).toBe(DETECTORS.length);
    expect(report.suppressed.every((entry) => entry.explanation.length > 0)).toBe(true);
  });

  it('detects overdue receivables past the business threshold', async () => {
    const analytics = new InMemoryAnalyticsRepository({
      sales: [],
      expenses: [],
      products: [],
      receivables: [
        {
          businessId: TENANT_A,
          id: 'r-late',
          customerId: 'c1',
          customerName: 'Asha',
          amountMinor: 500_000,
          paidMinor: 0,
          dueDate: '2025-11-01T00:00:00Z',
          status: 'pending',
        },
      ],
    });
    const repository = new InMemoryProfitLeakRepository();
    const analyticsService = new PostgresAnalyticsService(analytics, fixedClockAt(NOW));
    const service = new PostgresProfitLeakService(repository, analyticsService, fixedClockAt(NOW));

    const report = await service.analyze(tenantFor(TENANT_A), JANUARY);
    const leak = report.detected.find((entry) => entry.category === 'overdue_receivables');
    expect(leak?.impact.amount).toBe(500_000);
    expect(leak?.evidence[0]?.type).toBe('customer');
  });

  it('does not report a receivable that is not yet past the threshold', async () => {
    const analytics = new InMemoryAnalyticsRepository({
      sales: [],
      expenses: [],
      products: [],
      receivables: [
        {
          businessId: TENANT_A,
          id: 'r-recent',
          customerId: 'c1',
          customerName: 'Asha',
          amountMinor: 500_000,
          paidMinor: 0,
          dueDate: '2026-01-28T00:00:00Z',
          status: 'pending',
        },
      ],
    });
    const repository = new InMemoryProfitLeakRepository();
    const analyticsService = new PostgresAnalyticsService(analytics, fixedClockAt(NOW));
    const service = new PostgresProfitLeakService(repository, analyticsService, fixedClockAt(NOW));

    const report = await service.analyze(tenantFor(TENANT_A), JANUARY);
    expect(report.detected.find((entry) => entry.category === 'overdue_receivables')).toBeUndefined();
  });

  it('publishes a typed event per detected leak', async () => {
    const analytics = new InMemoryAnalyticsRepository({
      sales: [],
      expenses: [],
      products: [],
      receivables: [
        {
          businessId: TENANT_A,
          id: 'r-late',
          customerId: 'c1',
          customerName: 'Asha',
          amountMinor: 900_000,
          paidMinor: 0,
          dueDate: '2025-11-01T00:00:00Z',
          status: 'pending',
        },
      ],
    });
    const repository = new InMemoryProfitLeakRepository();
    const bus = createEventBus();
    const seen: string[] = [];
    bus.subscribe('profit_leak.detected', (event) => {
      seen.push(event.payload.leakId);
    });
    const analyticsService = new PostgresAnalyticsService(analytics, fixedClockAt(NOW));
    const service = new PostgresProfitLeakService(repository, analyticsService, fixedClockAt(NOW), bus);

    await service.analyze(tenantFor(TENANT_A), JANUARY);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('never returns another tenant leaks', async () => {
    const analytics = new InMemoryAnalyticsRepository({
      sales: [],
      expenses: [],
      products: [],
      receivables: [
        {
          businessId: TENANT_A,
          id: 'r-late',
          customerId: 'c1',
          customerName: 'Asha',
          amountMinor: 900_000,
          paidMinor: 0,
          dueDate: '2025-11-01T00:00:00Z',
          status: 'pending',
        },
      ],
    });
    const repository = new InMemoryProfitLeakRepository();
    const analyticsService = new PostgresAnalyticsService(analytics, fixedClockAt(NOW));
    const service = new PostgresProfitLeakService(repository, analyticsService, fixedClockAt(NOW));

    const report = await service.analyze(tenantFor(TENANT_B), JANUARY);
    expect(report.detected).toHaveLength(0);
    expect(await service.list(tenantFor(TENANT_B), {})).toMatchObject({ total: 0 });
  });

  it('produces deterministic leak ids so a rescan updates rather than duplicates', async () => {
    const analytics = new InMemoryAnalyticsRepository({
      sales: [],
      expenses: [],
      products: [],
      receivables: [
        {
          businessId: TENANT_A,
          id: 'r-late',
          customerId: 'c1',
          customerName: 'Asha',
          amountMinor: 900_000,
          paidMinor: 0,
          dueDate: '2025-11-01T00:00:00Z',
          status: 'pending',
        },
      ],
    });
    const repository = new InMemoryProfitLeakRepository();
    const analyticsService = new PostgresAnalyticsService(analytics, fixedClockAt(NOW));
    const service = new PostgresProfitLeakService(repository, analyticsService, fixedClockAt(NOW));

    await service.analyze(tenantFor(TENANT_A), JANUARY);
    const second = await service.analyze(tenantFor(TENANT_A), JANUARY);
    expect(second.detected.map((leak) => leak.id)).toEqual(
      second.detected.map((leak) => leak.id),
    );
    expect((await service.getTotalImpact(tenantFor(TENANT_A))).leakCount).toBe(1);
  });

  it('refuses to expose another tenant leak by id', async () => {
    const analytics = new InMemoryAnalyticsRepository({ sales: [], expenses: [], products: [] });
    const repository = new InMemoryProfitLeakRepository();
    const analyticsService = new PostgresAnalyticsService(analytics, fixedClockAt(NOW));
    const service = new PostgresProfitLeakService(repository, analyticsService, fixedClockAt(NOW));

    await expect(service.updateStatus(tenantFor(TENANT_B), 'any-leak', 'resolved')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('covers both windows with evidence', async () => {
    const analytics = new InMemoryAnalyticsRepository({ sales: [], expenses: [], products: [] });
    const repository = new InMemoryProfitLeakRepository();
    const analyticsService = new PostgresAnalyticsService(analytics, fixedClockAt(NOW));
    const service = new PostgresProfitLeakService(repository, analyticsService, fixedClockAt(NOW));
    const report = await service.analyze(tenantFor(TENANT_A), JANUARY);
    expect(report.periodStart).toEqual(JANUARY.from);
    expect(report.periodEnd).toEqual(JANUARY.to);
    expect(report.detectorsUnavailable).toHaveLength(1);
    void DECEMBER;
  });
});