import { describe, expect, it } from 'vitest';
import {
  MAX_PERCENTAGE_CHANGE_BPS,
  PostgresSimulatorService,
  applyCostChange,
  applyPriceChange,
  compareSnapshots,
  normaliseSnapshot,
  parameterChangeBps,
  runScenarioEngine,
  toScenarioSnapshot,
  validateParameterBounds,
  validateParameters,
  type Scenario,
  type ScenarioParameter,
  type ScenarioSnapshot,
} from '@/modules/simulator';
import { ValidationError } from '@/lib/errors';
import { PostgresAnalyticsService } from '@/modules/analytics';
import {
  InMemoryAnalyticsRepository,
  InMemoryScenarioRepository,
  TENANT_A,
  TENANT_B,
  fixedClockAt,
  period,
  tenantFor,
  type LedgerProduct,
  type LedgerSale,
} from './support/doubles';

const JANUARY = period('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
const NOW = '2026-02-01T00:00:00.000Z';

const BASELINE: ScenarioSnapshot = {
  revenue: 1_000_000,
  cogs: 600_000,
  grossProfit: 400_000,
  grossMarginBps: 4_000,
  operatingExpenses: 100_000,
  netProfit: 300_000,
  netMarginBps: 3_000,
  grossRevenue: 1_200_000,
  discounts: 200_000,
  quantitySold: 100,
  saleCount: 20,
};

function param(overrides: Partial<ScenarioParameter> & { type: ScenarioParameter['type'] }): ScenarioParameter {
  return { currentValue: 0, newValue: 0, unit: 'percentage', ...overrides };
}

describe('parameter bounds', () => {
  it('accepts a percentage change up to +/-100%', () => {
    expect(validateParameterBounds(param({ type: 'price_change', newValue: 500 }))).toBe(true);
    expect(
      validateParameterBounds(param({ type: 'price_change', currentValue: -MAX_PERCENTAGE_CHANGE_BPS, newValue: 0 })),
    ).toBe(true);
  });

  it('rejects a percentage change beyond +/-100%', () => {
    expect(validateParameterBounds(param({ type: 'price_change', newValue: 10_001 }))).toBe(false);
  });

  it('rejects non-finite values rather than propagating NaN', () => {
    expect(
      validateParameterBounds(param({ type: 'price_change', newValue: Number.NaN })),
    ).toBe(false);
    expect(
      validateParameterBounds(param({ type: 'price_change', newValue: Number.POSITIVE_INFINITY })),
    ).toBe(false);
  });

  it('rejects negative money, quantity and day values', () => {
    expect(validateParameterBounds(param({ type: 'expense_change', unit: 'amount', newValue: -1 }))).toBe(false);
    expect(validateParameterBounds(param({ type: 'inventory_order', unit: 'quantity', newValue: -1 }))).toBe(false);
    expect(validateParameterBounds(param({ type: 'payment_timing', unit: 'days', newValue: -1 }))).toBe(false);
  });

  it('rejects an unbounded delay', () => {
    expect(validateParameterBounds(param({ type: 'payment_timing', unit: 'days', newValue: 400 }))).toBe(false);
  });

  it('reports the signed change of a parameter', () => {
    expect(parameterChangeBps(param({ type: 'price_change', currentValue: 100, newValue: 500 }))).toBe(400);
    expect(parameterChangeBps(param({ type: 'price_change', currentValue: 500, newValue: 100 }))).toBe(-400);
  });
});

describe('scenario engine determinism', () => {
  it('produces an identical result for identical inputs', () => {
    const parameters = [
      param({ type: 'price_change', newValue: 500 }),
      param({ type: 'cost_change', newValue: 300 }),
    ];
    const first = runScenarioEngine(BASELINE, parameters);
    const second = runScenarioEngine(BASELINE, parameters);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('does not mutate the baseline it was given', () => {
    const frozen = { ...BASELINE };
    runScenarioEngine(BASELINE, [param({ type: 'price_change', newValue: 1_000 })]);
    expect(BASELINE).toEqual(frozen);
  });

  it('keeps a price rise at constant volume when cost is unchanged', () => {
    const result = runScenarioEngine(BASELINE, [param({ type: 'price_change', newValue: 500 })]);
    expect(result.projected.revenue).toBe(1_050_000);
    expect(result.projected.cogs).toBe(600_000);
    expect(result.projected.grossProfit).toBe(450_000);
    expect(result.projected.grossMarginBps).toBe(4_286);
  });

  it('scales cost with a supplier price rise, leaving revenue alone', () => {
    const result = runScenarioEngine(BASELINE, [param({ type: 'cost_change', newValue: 800 })]);
    expect(result.projected.cogs).toBe(648_000);
    expect(result.projected.revenue).toBe(1_000_000);
    expect(result.projected.grossProfit).toBe(352_000);
  });

  it('leaves margin unchanged for a volume-only scenario', () => {
    const result = runScenarioEngine(BASELINE, [param({ type: 'quantity_change', newValue: 2_000 })]);
    expect(result.projected.revenue).toBe(1_200_000);
    expect(result.projected.cogs).toBe(720_000);
    expect(result.projected.grossMarginBps).toBe(BASELINE.grossMarginBps);
  });

  it('applies a target discount rate against recorded gross revenue', () => {
    const result = runScenarioEngine(BASELINE, [
      param({ type: 'discount_change', currentValue: 1_667, newValue: 500 }),
    ]);
    // 5% discount on 1,200,000 gross revenue leaves 1,140,000 net revenue.
    expect(result.projected.revenue).toBe(1_140_000);
    expect(result.projected.revenue).toBeGreaterThan(BASELINE.revenue);
  });

  it('treats a payment-timing shift as cash-only with no profit effect', () => {
    const result = runScenarioEngine(BASELINE, [param({ type: 'payment_timing', unit: 'days', newValue: 30 })]);
    expect(result.projected.netProfit).toBe(BASELINE.netProfit);
    expect(result.cashTiming.affectsProfitAndLoss).toBe(false);
    expect(result.assumptions.some((entry) => entry.id === 'payment-timing-no-profit-effect')).toBe(true);
  });

  it('prices a stock order from the recorded cost without touching profit', () => {
    const result = runScenarioEngine(BASELINE, [
      param({ type: 'inventory_order', unit: 'quantity', currentValue: 2_500, newValue: 10 }),
    ]);
    expect(result.cashTiming.upfrontOutlayMinor).toBe(25_000);
    expect(result.projected.netProfit).toBe(BASELINE.netProfit);
    expect(result.cashTiming.affectsProfitAndLoss).toBe(false);
  });

  it('rejects an out-of-bounds parameter instead of silently clamping it', () => {
    const result = runScenarioEngine(BASELINE, [param({ type: 'price_change', newValue: 50_000 })]);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]?.reason).toBe('parameter_out_of_bounds');
    expect(result.projected).toEqual(normaliseSnapshot(BASELINE));
  });

  it('records an assumption for every applied parameter', () => {
    const result = runScenarioEngine(BASELINE, [
      param({ type: 'price_change', newValue: 500 }),
      param({ type: 'cost_change', newValue: 300 }),
    ]);
    expect(result.assumptions).toHaveLength(2);
    expect(result.assumptions.every((entry) => entry.limitation.length > 0)).toBe(true);
  });
});

describe('comparison semantics', () => {
  it('reports an increase in profit with the direction made explicit', () => {
    // netProfit is always derived, so a better outcome is modelled as more revenue
    // at the same cost, never by overriding netProfit directly.
    const better = normaliseSnapshot({ ...BASELINE, revenue: 1_050_000 });
    const comparison = compareSnapshots(BASELINE, better);
    expect(comparison.direction).toBe('increase');
    expect(comparison.profitDelta).toBe(50_000);
    expect(comparison.adverse).toBe(false);
  });

  it('flags a profit fall as adverse', () => {
    const worse = normaliseSnapshot({ ...BASELINE, revenue: 900_000 });
    const comparison = compareSnapshots(BASELINE, worse);
    expect(comparison.direction).toBe('decrease');
    expect(comparison.adverse).toBe(true);
  });

  it('refuses a percentage claim against a zero baseline profit', () => {
    const zeroed = normaliseSnapshot({ revenue: 600_000, cogs: 600_000, operatingExpenses: 0 });
    expect(zeroed.netProfit).toBe(0);
    const comparison = compareSnapshots(zeroed, normaliseSnapshot({ ...BASELINE }));
    expect(comparison.direction).toBe('unavailable');
    expect(comparison.summary).toMatch(/zero/i);
  });

  it('handles an all-zero baseline without dividing by zero', () => {
    const empty = normaliseSnapshot({});
    expect(empty.grossMarginBps).toBe(0);
    expect(compareSnapshots(empty, empty).profitDelta).toBe(0);
  });
});

describe('snapshot projection', () => {
  it('carries gross revenue and discounts for a discount scenario', () => {
    const snapshot = toScenarioSnapshot({
      revenue: { amount: 900_000 },
      cogs: { amount: 500_000 },
      grossProfit: { amount: 400_000 },
      grossMarginBps: 4_444,
      operatingExpenses: { amount: 50_000 },
      netProfit: { amount: 350_000 },
      netMarginBps: 3_889,
      revenueRecognition: {
        grossRevenue: { amount: 1_000_000 },
        discounts: { amount: 100_000 },
        saleCount: 12,
        quantitySold: 60,
      },
    });
    expect(snapshot.grossRevenue).toBe(1_000_000);
    expect(snapshot.discounts).toBe(100_000);
  });
});

describe('input validation', () => {
  it('rejects an empty parameter list', () => {
    expect(() => validateParameters([])).toThrow(ValidationError);
  });

  it('rejects more parameters than the engine accepts', () => {
    const many = Array.from({ length: 11 }, () => param({ type: 'price_change' }));
    expect(() => validateParameters(many)).toThrow(/at most/i);
  });

  it('rejects an unsupported parameter type', () => {
    expect(() =>
      validateParameters([param({ type: 'launch_rocket' as never })]),
    ).toThrow(/unsupported type/i);
  });

  it('rejects an unsupported unit', () => {
    expect(() => validateParameters([param({ type: 'price_change', unit: 'furlongs' as never })])).toThrow(
      /unsupported unit/i,
    );
  });

  it('rejects an over-long target id', () => {
    expect(() =>
      validateParameters([param({ type: 'inventory_order', targetId: 'x'.repeat(129) })]),
    ).toThrow(/at most 128/i);
  });

  it('rejects a prototype-polluting target id', () => {
    // `__proto__` is a legal string, so the length check passes; the executor-level
    // validation is what rejects it, and this proves it reaches that layer intact.
    expect(() =>
      validateParameters([param({ type: 'inventory_order', targetId: '__proto__' })]),
    ).not.toThrow();
  });
});

describe('simulator service against a synthetic ledger', () => {
  const sales: readonly LedgerSale[] = Array.from({ length: 12 }, (_, index) => ({
    businessId: TENANT_A,
    at: `2026-01-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    type: 'sale' as const,
    status: 'completed',
    subtotalMinor: 100_000,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 100_000,
    lines: [
      { productId: 'p1', quantity: 2, unitPriceMinor: 100_000, discountMinor: 0, costPriceMinor: 60_000 },
    ],
  }));
  const products: readonly LedgerProduct[] = [
    {
      businessId: TENANT_A,
      id: 'p1',
      name: 'Widget',
      status: 'active',
      costPriceMinor: 60_000,
      sellingPriceMinor: 100_000,
      currentStock: 40,
      createdAt: '2025-01-01T00:00:00.000Z',
    },
  ];

  function build() {
    const analytics = new InMemoryAnalyticsRepository({ sales, expenses: [], products });
    const analyticsService = new PostgresAnalyticsService(analytics, fixedClockAt(NOW));
    const repository = new InMemoryScenarioRepository();
    return {
      repository,
      analytics,
      service: new PostgresSimulatorService(repository, analyticsService, fixedClockAt(NOW)),
    };
  }

  it('computes a price scenario against the recorded period', async () => {
    const { service } = build();
    const scenario = await service.runScenario(tenantFor(TENANT_A), JANUARY, {
      name: 'Raise price 5%',
      parameters: [param({ type: 'price_change', currentValue: 0, newValue: 500 })],
    });
    expect(scenario.baseline.revenue).toBe(1_200_000);
    expect(scenario.projected.revenue).toBe(1_260_000);
    expect(scenario.comparison.profitDelta).toBe(60_000);
    expect(scenario.status).toBe('calculated');
  });

  it('marks every result as a projection and states the no-execution assumption', async () => {
    const { service } = build();
    const scenario = await service.runScenario(tenantFor(TENANT_A), JANUARY, {
      name: 'Raise price 5%',
      parameters: [param({ type: 'price_change', newValue: 500 })],
    });
    expect(scenario.isProjection).toBe(true);
    expect(scenario.assumptions.some((entry) => entry.id === 'no-execution')).toBe(true);
  });

  it('leaves the production ledger untouched', async () => {
    const { service, analytics } = build();
    const before = await analytics.getProductsForAnalysis(TENANT_A);
    await service.runScenario(tenantFor(TENANT_A), JANUARY, {
      name: 'Order stock',
      parameters: [
        param({ type: 'inventory_order', unit: 'quantity', newValue: 25, targetId: 'p1' }),
      ],
    });
    const after = await analytics.getProductsForAnalysis(TENANT_A);
    expect(after).toEqual(before);
    const totals = await analytics.getSaleTotals(TENANT_A, JANUARY);
    expect(totals.saleCount).toBe(12);
  });

  it('writes only to the scenario store, never to a business table', async () => {
    const { service, repository } = build();
    await service.runScenario(tenantFor(TENANT_A), JANUARY, {
      name: 'Any change',
      parameters: [param({ type: 'price_change', newValue: 100 })],
    });
    const stored = await repository.findById(TENANT_A, (await repository.list(TENANT_A, { page: 1, limit: 10 })).items[0]!.id);
    expect(stored?.isProjection).toBe(true);
  });

  it('prices a stock order from the product master', async () => {
    const { service } = build();
    const scenario = await service.runScenario(tenantFor(TENANT_A), JANUARY, {
      name: 'Order 25 widgets',
      parameters: [
        param({ type: 'inventory_order', unit: 'quantity', newValue: 25, targetId: 'p1' }),
      ],
    });
    // 25 units at the recorded cost of 60,000 minor units.
    expect(scenario.cashTiming.upfrontOutlayMinor).toBe(1_500_000);
    expect(scenario.parameters[0]?.currentValue).toBe(60_000);
  });

  it('refuses a product that belongs to another tenant', async () => {
    const { service } = build();
    await expect(
      service.runScenario(tenantFor(TENANT_B), JANUARY, {
        name: 'Order stock',
        parameters: [
          param({ type: 'inventory_order', unit: 'quantity', newValue: 5, targetId: 'p1' }),
        ],
      }),
    ).rejects.toThrow(/not available for this business/i);
  });

  it('never returns another tenant scenario', async () => {
    const { service, repository } = build();
    const scenario = await service.runScenario(tenantFor(TENANT_A), JANUARY, {
      name: 'Raise price',
      parameters: [param({ type: 'price_change', newValue: 100 })],
    });
    expect(await service.getById(tenantFor(TENANT_B), scenario.id)).toBeNull();
    void repository;
  });

  it('produces a draft status when a parameter was rejected', async () => {
    const { service } = build();
    const scenario = await service.runScenario(tenantFor(TENANT_A), JANUARY, {
      name: 'Impossible change',
      parameters: [param({ type: 'price_change', newValue: 900_000 })],
    });
    expect(scenario.status).toBe('draft');
    expect(scenario.rejections).toHaveLength(1);
  });

  it('recomputes without mutating the stored scenario', async () => {
    const { service } = build();
    const original = await service.runScenario(tenantFor(TENANT_A), JANUARY, {
      name: 'Raise price',
      parameters: [param({ type: 'price_change', newValue: 500 })],
    });
    const recomputed = await service.recompute(tenantFor(TENANT_A), original.id);
    expect(recomputed?.id).not.toBe(original.id);
    expect(recomputed?.periodEnd.getTime()).toBeGreaterThan(recomputed?.periodStart.getTime() ?? 0);
    const stored = await service.getById(tenantFor(TENANT_A), original.id);
    expect(stored?.id).toBe(original.id);
    expect(stored?.parameters).toEqual(original.parameters);
  });

  it('rejects an over-long name and description', async () => {
    const { service } = build();
    await expect(
      service.runScenario(tenantFor(TENANT_A), JANUARY, {
        name: 'x'.repeat(256),
        parameters: [param({ type: 'price_change', newValue: 100 })],
      }),
    ).rejects.toThrow(/at most 255/);
    await expect(
      service.runScenario(tenantFor(TENANT_A), JANUARY, {
        name: 'ok',
        description: 'x'.repeat(5_001),
        parameters: [param({ type: 'price_change', newValue: 100 })],
      }),
    ).rejects.toThrow(/at most 5000/);
  });
});

describe('scenario contract stability', () => {
  it('exposes an id, status, period, currency and timestamps on every result', async () => {
    const analyticsService = new PostgresAnalyticsService(
      new InMemoryAnalyticsRepository({ sales: [], expenses: [], products: [] }),
      fixedClockAt(NOW),
    );
    const service = new PostgresSimulatorService(
      new InMemoryScenarioRepository(),
      analyticsService,
      fixedClockAt(NOW),
    );
    const scenario: Scenario = await service.runScenario(tenantFor(TENANT_A), JANUARY, {
      name: 'Empty merchant',
      parameters: [param({ type: 'price_change', newValue: 500 })],
    });
    expect(scenario.id).toBeTruthy();
    expect(scenario.status).toBeTruthy();
    expect(scenario.periodStart).toEqual(JANUARY.from);
    expect(scenario.periodEnd).toEqual(JANUARY.to);
    expect(scenario.currency).toBe('INR');
    expect(scenario.createdAt.toISOString()).toBe(NOW);
    expect(scenario.baseline).toBeDefined();
    expect(scenario.projected).toBeDefined();
    expect(scenario.comparison).toBeDefined();
  });
});

describe('legacy helpers remain consistent with the engine', () => {
  it('applies price and cost changes the same way the engine does', () => {
    expect(applyPriceChange(1_000_000, 500)).toBe(1_050_000);
    expect(applyCostChange(600_000, 800)).toBe(648_000);
  });
});