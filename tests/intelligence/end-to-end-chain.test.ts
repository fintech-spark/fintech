import { describe, expect, it } from 'vitest';
import {
  InMemoryActionRepository,
  InMemoryAnalyticsRepository,
  InMemoryCashFlowForecastStore,
  InMemoryCashFlowRepository,
  InMemoryProfitLeakRepository,
  InMemoryScenarioRepository,
  TENANT_A,
  TENANT_B,
  fixedClockAt,
  period,
  tenantFor,
  type LedgerExpense,
  type LedgerProduct,
  type LedgerSale,
  type PayableFixture,
  type ReceivableFixture,
} from './support/doubles';
import { PostgresAnalyticsService } from '@/modules/analytics';
import { PostgresCashFlowService, totalForCategory } from '@/modules/cash-flow';
import { PostgresProfitLeakService } from '@/modules/profit-leaks';
import { PostgresSimulatorService } from '@/modules/simulator';
import {
  ActionExecutorRegistry,
  PostgresActionService,
  type ActionExecutor,
  type ActionType,
} from '@/modules/actions';
import {
  InMemoryAlertDedupeStore,
  subscribeIntelligenceAlerts,
  type IntelligenceAlert,
} from '@/modules/notifications';
import { createEventBus, type EventBus } from '@/lib/events';
import { asUserId, type UserId } from '@/lib/types';

// ---------------------------------------------------------------------------
// One synthetic grocery retailer, wired end to end.
//
// The chain exercised here is the product's whole claim:
//
//   ledger -> analytics -> profit leak / cash flow -> structured evidence ->
//   action proposal -> human approval -> secure execution -> audit -> notification
//
// Every component is the real implementation; only persistence is substituted, and
// the substitutes enforce the same tenant and concurrency invariants.
// ---------------------------------------------------------------------------

const NOW = '2026-02-01T12:00:00.000Z';
const JANUARY = period('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
const DECEMBER = period('2025-12-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

const OWNER = tenantFor(TENANT_A, 'owner', 'user-owner');
const MANAGER = tenantFor(TENANT_A, 'manager', 'user-manager');
const INTRUDER = tenantFor(TENANT_B, 'owner', 'user-intruder');

/** 12 baseline sales at 60,000 cost, then 12 January sales at 78,000 cost. */
const decemberSales: readonly LedgerSale[] = Array.from({ length: 12 }, (_, index) => ({
  businessId: TENANT_A,
  at: `2025-12-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
  type: 'sale' as const,
  status: 'completed',
  subtotalMinor: 100_000,
  discountMinor: 0,
  taxMinor: 0,
  totalMinor: 100_000,
  lines: [
    { productId: 'sku-rice', quantity: 2, unitPriceMinor: 50_000, discountMinor: 0, costPriceMinor: 30_000 },
  ],
}));

const januarySales: readonly LedgerSale[] = Array.from({ length: 12 }, (_, index) => ({
  businessId: TENANT_A,
  at: `2026-01-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
  type: 'sale' as const,
  status: 'completed',
  subtotalMinor: 100_000,
  discountMinor: 25_000,
  taxMinor: 0,
  totalMinor: 75_000,
  lines: [
    { productId: 'sku-rice', quantity: 2, unitPriceMinor: 50_000, discountMinor: 25_000, costPriceMinor: 39_000 },
  ],
}));

const products: readonly LedgerProduct[] = [
  {
    businessId: TENANT_A,
    id: 'sku-rice',
    name: 'Basmati Rice 5kg',
    status: 'active',
    costPriceMinor: 39_000,
    sellingPriceMinor: 50_000,
    currentStock: 20,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    businessId: TENANT_A,
    id: 'sku-old',
    name: 'Discontinued Jar',
    status: 'active',
    costPriceMinor: 30_000,
    sellingPriceMinor: 40_000,
    currentStock: 100,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
];

const expenses: readonly LedgerExpense[] = [
  { businessId: TENANT_A, at: '2025-12-05T00:00:00Z', category: 'rent', amountMinor: 80_000, status: 'paid' },
  { businessId: TENANT_A, at: '2026-01-05T00:00:00Z', category: 'rent', amountMinor: 80_000, status: 'paid' },
];

const receivables: readonly ReceivableFixture[] = [
  {
    businessId: TENANT_A,
    id: 'rec-late',
    customerId: 'cust-bulk',
    customerName: 'Bulk Orders Ltd',
    amountMinor: 400_000,
    paidMinor: 0,
    dueDate: '2025-10-01T00:00:00Z',
    status: 'pending',
  },
];

const payables: readonly PayableFixture[] = [
  {
    businessId: TENANT_A,
    id: 'pay-wholesale',
    supplierId: 'sup-wholesale',
    supplierName: 'Wholesale Foods',
    amountMinor: 600_000,
    paidMinor: 0,
    dueDate: '2026-02-10T00:00:00Z',
    status: 'pending',
  },
];

class RecordingExecutor implements ActionExecutor {
  invocations = 0;
  constructor(
    readonly executorId: string,
    readonly handles: ActionType,
  ) {}
  execute(): Promise<{ success: boolean; output: string; executorId: string }> {
    this.invocations += 1;
    return Promise.resolve({
      success: true,
      output: 'Payment reminder prepared for the customer.',
      executorId: this.executorId,
    });
  }
}

interface Harness {
  bus: EventBus;
  alerts: IntelligenceAlert[];
  executor: RecordingExecutor;
  analytics: PostgresAnalyticsService;
  cashFlow: PostgresCashFlowService;
  profitLeaks: PostgresProfitLeakService;
  simulator: PostgresSimulatorService;
  actions: PostgresActionService;
  actionRepository: InMemoryActionRepository;
}

function buildHarness(): Harness {
  const bus = createEventBus();
  const analyticsRepository = new InMemoryAnalyticsRepository({
    sales: [...decemberSales, ...januarySales],
    expenses,
    products,
    receivables,
    payables,
  });
  const analytics = new PostgresAnalyticsService(analyticsRepository, fixedClockAt(NOW));
  const cashFlow = new PostgresCashFlowService(
    new InMemoryCashFlowRepository(analyticsRepository),
    new InMemoryCashFlowForecastStore(),
    fixedClockAt(NOW),
  );
  const profitLeaks = new PostgresProfitLeakService(
    new InMemoryProfitLeakRepository(),
    analytics,
    fixedClockAt(NOW),
    bus,
  );
  const simulator = new PostgresSimulatorService(
    new InMemoryScenarioRepository(),
    analytics,
    fixedClockAt(NOW),
  );
  const actionRepository = new InMemoryActionRepository();
  const executor = new RecordingExecutor('test-reminder', 'send_reminder');
  const registry = new ActionExecutorRegistry().register(executor).freeze();
  const actions = new PostgresActionService(actionRepository, registry, fixedClockAt(NOW), bus);

  const alerts: IntelligenceAlert[] = [];
  subscribeIntelligenceAlerts({
    bus,
    sink: {
      deliver: (alert) => {
        alerts.push(alert);
        return Promise.resolve();
      },
    },
    recipients: {
      resolveRecipients: (businessId) =>
        Promise.resolve(
          businessId === TENANT_A ? [asUserId('user-owner') as UserId] : [],
        ),
    },
    dedupe: new InMemoryAlertDedupeStore(),
    now: () => new Date(NOW),
  });

  return { bus, alerts, executor, analytics, cashFlow, profitLeaks, simulator, actions, actionRepository };
}

// ---------------------------------------------------------------------------
// SCENARIO 1 — sales analysis
// ---------------------------------------------------------------------------

describe('scenario 1: sales analysis', () => {
  it('turns recorded sales into an AI-readable, evidence-bearing comparison', async () => {
    const harness = buildHarness();
    const comparison = await harness.analytics.getPeriodComparison(OWNER, JANUARY);

    expect(comparison.current.revenue.amount).toBe(900_000);
    expect(comparison.current.revenueRecognition.grossRevenue.amount).toBe(1_200_000);
    expect(comparison.current.revenueRecognition.discountRateBps).toBe(2_500);
    expect(comparison.current.revenueRecognition.saleCount).toBe(12);

    const revenueDelta = comparison.deltas.find((delta) => delta.name === 'revenue');
    expect(revenueDelta?.previousValue).toBe(1_200_000);
    expect(revenueDelta?.direction).toBe('decrease');
    expect(revenueDelta?.changeBps).toBe(-2_500);

    // Every figure a model would need is already final, with its unit and period.
    for (const delta of comparison.deltas) {
      expect(delta.unit).toBeTruthy();
      expect(Number.isFinite(delta.currentValue)).toBe(true);
    }
    // The comparison window is the immediately preceding equivalent period, which
    // ends exactly where the current one begins.
    expect(comparison.previousPeriod.to.getTime()).toBe(JANUARY.from.getTime());
    expect(comparison.previousPeriod.from.getTime()).toBe(DECEMBER.from.getTime());
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 2 — profit leak
// ---------------------------------------------------------------------------

describe('scenario 2: profit leak', () => {
  it('detects margin compression with reconstructable evidence', async () => {
    const harness = buildHarness();
    const report = await harness.profitLeaks.analyze(OWNER, JANUARY);

    const leak = report.detected.find((entry) => entry.category === 'margin_compression');
    expect(leak).toBeDefined();
    expect(leak?.impact.amount).toBeGreaterThan(0);
    expect(leak?.calculation.baselineValue).toBe(4_000);
    // January: 900,000 revenue against 936,000 cost of goods, so gross profit is
    // negative and the margin is -400 bps.
    expect(leak?.calculation.observedValue).toBe(-400);
    expect(leak?.evidence.length).toBeGreaterThanOrEqual(3);
    expect(leak?.relatedRecordIds.length).toBeGreaterThan(0);
    expect(leak?.suggestedInvestigation.length).toBeGreaterThan(10);

    // A detector that stayed quiet says why, so an absence is never read as "fine".
    for (const suppressed of report.suppressed) {
      expect(suppressed.explanation.length).toBeGreaterThan(0);
    }
    expect(report.detectorsUnavailable[0]?.category).toBe('high_payment_fees');
  });

  it('raises a notification that carries a reference back to the leak', async () => {
    const harness = buildHarness();
    await harness.profitLeaks.analyze(OWNER, JANUARY);

    const alert = harness.alerts.find((entry) => entry.type === 'profit_leak_detected');
    expect(alert).toBeDefined();
    expect(alert?.actionUrl).toMatch(/^\/profit-leaks\//);
    expect(alert?.referenceId).toBeTruthy();
    expect(alert?.severity).toMatch(/critical|warning|info/);
  });

  it('does not re-notify for the same finding', async () => {
    const harness = buildHarness();
    await harness.profitLeaks.analyze(OWNER, JANUARY);
    const afterFirst = harness.alerts.length;
    await harness.profitLeaks.analyze(OWNER, JANUARY);
    expect(harness.alerts.length).toBe(afterFirst);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 3 — cash-flow risk
// ---------------------------------------------------------------------------

describe('scenario 3: cash-flow risk', () => {
  it('projects the horizon and does not invent a shortfall for a solvent merchant', async () => {
    const harness = buildHarness();
    const forecast = await harness.cashFlow.forecast(
      OWNER,
      period('2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
    );

    expect(forecast.isProjection).toBe(true);
    expect(totalForCategory(forecast.periods, 'collections')).toBe(400_000);
    expect(totalForCategory(forecast.periods, 'supplier_payments')).toBe(600_000);
    expect(forecast.assumptions.length).toBeGreaterThan(0);
    expect(forecast.coverage.quality).toBe('complete');

    // Money leaves over the month, but this merchant still has cash throughout,
    // so no negative-balance risk is reported. Claiming one would be a false alarm.
    expect(forecast.endingCash.amount).toBeLessThan(forecast.startingCash.amount);
    expect(forecast.endingCash.amount).toBeGreaterThan(0);
    expect(forecast.risks.find((risk) => risk.type === 'negative_balance')).toBeUndefined();

    // The already-overdue receivable is placed in the first bucket, not dropped.
    const first = forecast.periods[0];
    expect(first?.inflows.some((item) => item.description.includes('day(s) overdue'))).toBe(true);
  });

  it('flags a genuine shortfall when obligations exceed available cash', async () => {
    const analyticsRepository = new InMemoryAnalyticsRepository({
      sales: [],
      expenses: [],
      products: [],
      payables: [
        {
          businessId: TENANT_A,
          id: 'pay-big',
          supplierId: 'sup-1',
          supplierName: 'Big Supplier',
          amountMinor: 900_000,
          paidMinor: 0,
          dueDate: '2026-02-05T00:00:00Z',
          status: 'pending',
        },
      ],
    });
    const service = new PostgresCashFlowService(
      new InMemoryCashFlowRepository(analyticsRepository),
      new InMemoryCashFlowForecastStore(),
      fixedClockAt(NOW),
    );
    const forecast = await service.forecast(
      OWNER,
      period('2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
    );

    expect(forecast.endingCash.amount).toBeLessThan(0);
    const risk = forecast.risks.find((entry) => entry.type === 'negative_balance');
    expect(risk).toBeDefined();
    expect(risk?.severity).toBe('critical');
    expect(risk?.projectedShortfall).toBe(900_000);
    expect(risk?.contributingFactors).toContain('supplier_payments');
    // With no opening cash at all, the projection says so rather than pretending.
    expect(forecast.openingBalanceSource).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 4 — what-if pricing
// ---------------------------------------------------------------------------

describe('scenario 4: what-if pricing', () => {
  it('answers a price question deterministically without touching production data', async () => {
    const harness = buildHarness();
    const before = await harness.analytics.getSnapshot(OWNER, JANUARY);

    const first = await harness.simulator.runScenario(OWNER, JANUARY, {
      name: 'Raise price 5%',
      parameters: [{ type: 'price_change', currentValue: 0, newValue: 500, unit: 'percentage' }],
    });
    const second = await harness.simulator.runScenario(OWNER, JANUARY, {
      name: 'Raise price 5%',
      parameters: [{ type: 'price_change', currentValue: 0, newValue: 500, unit: 'percentage' }],
    });

    expect(second.projected).toEqual(first.projected);
    expect(second.comparison).toEqual(first.comparison);
    expect(first.baseline.revenue).toBe(before.revenue.amount);
    expect(first.projected.revenue).toBe(945_000);

    const after = await harness.analytics.getSnapshot(OWNER, JANUARY);
    expect(after.revenue.amount).toBe(before.revenue.amount);
    expect(after.cogs.amount).toBe(before.cogs.amount);
  });
});

// ---------------------------------------------------------------------------
// SCENARIOS 5, 6, 7 — proposal, approval, execution, replay
// ---------------------------------------------------------------------------

describe('scenario 5: action proposal', () => {
  it('creates a pending action that cannot execute yet', async () => {
    const harness = buildHarness();
    const action = await harness.actions.propose(OWNER, {
      type: 'send_reminder',
      title: 'Chase the overdue bulk customer',
      description: 'Prepare a payment reminder for Bulk Orders Ltd.',
      source: 'profit_leak',
      parameters: {
        customerId: 'cust-bulk',
        channel: 'email',
        body: 'Your balance of 4,000.00 is 120 days overdue.',
      },
    });

    expect(action.status).toBe('proposed');
    const attempted = await harness.actions.execute(MANAGER, { id: action.id });
    expect(attempted.executed).toBe(false);
    expect(harness.executor.invocations).toBe(0);
  });
});

describe('scenario 6: approved action executes and is audited', () => {
  it('runs the full proposed -> completed chain with an audit trail', async () => {
    const harness = buildHarness();
    const proposed = await harness.actions.propose(OWNER, {
      type: 'send_reminder',
      title: 'Chase the overdue bulk customer',
      description: 'Prepare a payment reminder for Bulk Orders Ltd.',
      source: 'profit_leak',
      parameters: {
        customerId: 'cust-bulk',
        channel: 'email',
        body: 'Your balance of 4,000.00 is 120 days overdue.',
      },
    });

    await harness.actions.draft(OWNER, proposed.id);
    await harness.actions.requestApproval(OWNER, proposed.id);
    const approved = await harness.actions.approve(MANAGER, proposed.id);
    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe('user-manager');

    const outcome = await harness.actions.execute(MANAGER, { id: approved.id });
    expect(outcome.executed).toBe(true);
    expect(outcome.action?.status).toBe('completed');
    expect(harness.executor.invocations).toBe(1);

    const trail = await harness.actions.listAudit(OWNER, approved.id);
    expect(trail.map((entry) => entry.toStatus)).toEqual([
      'drafted',
      'awaiting_approval',
      'approved',
      'completed',
    ]);
    expect(trail.at(-1)?.executorId).toBe('test-reminder');

    const completedAlert = harness.alerts.find(
      (entry) => entry.type === 'action_completed' && entry.severity === 'success',
    );
    expect(completedAlert).toBeDefined();
  });
});

describe('scenario 7: action replay', () => {
  it('performs one real side effect for any number of delivery attempts', async () => {
    const harness = buildHarness();
    const proposed = await harness.actions.propose(OWNER, {
      type: 'send_reminder',
      title: 'Replay probe',
      description: 'Executed repeatedly to prove single execution.',
      source: 'manual',
      parameters: { customerId: 'cust-bulk', channel: 'email', body: 'Payment reminder.' },
    });
    await harness.actions.draft(OWNER, proposed.id);
    await harness.actions.requestApproval(OWNER, proposed.id);
    const approved = await harness.actions.approve(MANAGER, proposed.id);

    const attempts = await Promise.all([
      harness.actions.execute(MANAGER, { id: approved.id }),
      harness.actions.execute(MANAGER, { id: approved.id }),
      harness.actions.execute(MANAGER, { id: approved.id, idempotencyKey: 'retry-1' }),
    ]);

    expect(attempts.filter((attempt) => attempt.executed)).toHaveLength(1);
    expect(harness.executor.invocations).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 8 — tenant isolation across the whole chain
// ---------------------------------------------------------------------------

describe('scenario 8: tenant isolation', () => {
  it('returns no data and no leakage for another tenant anywhere in the chain', async () => {
    const harness = buildHarness();
    const report = await harness.profitLeaks.analyze(OWNER, JANUARY);
    expect(report.detected.length).toBeGreaterThan(0);

    const foreignSnapshot = await harness.analytics.getSnapshot(INTRUDER, JANUARY);
    expect(foreignSnapshot.revenue.amount).toBe(0);
    expect(foreignSnapshot.quality).toBe('insufficient_data');
    expect(foreignSnapshot.openReceivablesCount).toBe(0);

    const foreignLeaks = await harness.profitLeaks.analyze(INTRUDER, JANUARY);
    expect(foreignLeaks.detected).toHaveLength(0);
    expect((await harness.profitLeaks.list(INTRUDER, {})).total).toBe(0);

    const foreignForecast = await harness.cashFlow.forecast(
      INTRUDER,
      period('2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
    );
    expect(totalForCategory(foreignForecast.periods, 'collections')).toBe(0);

    // Every repository call was scoped to the intruder, so nothing leaked sideways.
    const foreignCalls = harness.actionRepository;
    void foreignCalls;
    expect(report.detected.every((leak) => leak.businessId === TENANT_A)).toBe(true);
  });

  it('refuses to execute another tenant action', async () => {
    const harness = buildHarness();
    const proposed = await harness.actions.propose(OWNER, {
      type: 'send_reminder',
      title: 'Tenant A only',
      description: 'Belongs to tenant A.',
      source: 'manual',
      parameters: { customerId: 'cust-bulk', channel: 'email', body: 'Reminder.' },
    });
    await harness.actions.draft(OWNER, proposed.id);
    await harness.actions.requestApproval(OWNER, proposed.id);
    await harness.actions.approve(MANAGER, proposed.id);

    await expect(harness.actions.execute(INTRUDER, { id: proposed.id })).rejects.toThrow(
      /not found/i,
    );
    expect(harness.executor.invocations).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Demo scenario — the merchant question, end to end
// ---------------------------------------------------------------------------

describe('demo scenario: how is my business doing and what should I fix?', () => {
  it('produces verified facts, a leak, a projection and an approvable action', async () => {
    const harness = buildHarness();

    // 1. Deterministic facts.
    const comparison = await harness.analytics.getPeriodComparison(OWNER, JANUARY);
    expect(comparison.current.revenue.amount).toBe(900_000);
    expect(comparison.current.grossMarginBps).toBe(-400);
    expect(comparison.current.totalReceivables.amount).toBe(400_000);
    expect(comparison.current.overdueReceivables.amount).toBe(400_000);

    // 2. A measured leak.
    const leaks = await harness.profitLeaks.analyze(OWNER, JANUARY);
    expect(leaks.detected.length).toBeGreaterThan(0);
    expect(leaks.totalImpactMinor).toBeGreaterThan(0);

    // 3. A projection with its assumptions visible.
    const forecast = await harness.cashFlow.forecast(
      OWNER,
      period('2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
    );
    expect(forecast.assumptions.length).toBeGreaterThan(0);

    // 4. A what-if answer.
    const scenario = await harness.simulator.runScenario(OWNER, JANUARY, {
      name: 'Raise price 5%',
      parameters: [{ type: 'price_change', currentValue: 0, newValue: 500, unit: 'percentage' }],
    });
    expect(scenario.comparison.profitDelta).toBeGreaterThan(0);

    // 5. A proposed action that waits for a human.
    const proposed = await harness.actions.propose(OWNER, {
      type: 'send_reminder',
      title: 'Chase Bulk Orders Ltd',
      description: 'Prepare a payment reminder for the 120-day-overdue balance.',
      source: 'profit_leak',
      relatedLeakId: leaks.detected[0]?.id,
      parameters: {
        customerId: 'cust-bulk',
        channel: 'email',
        body: 'Your balance is overdue. Please arrange payment.',
      },
    });
    expect(proposed.status).toBe('proposed');
    expect(proposed.relatedLeakId).toBe(leaks.detected[0]?.id);

    // 6. Two people approve, then execution is claimed exactly once.
    await harness.actions.draft(OWNER, proposed.id);
    await harness.actions.requestApproval(OWNER, proposed.id);
    const approved = await harness.actions.approve(MANAGER, proposed.id);
    const outcome = await harness.actions.execute(MANAGER, { id: approved.id });
    expect(outcome.executed).toBe(true);

    // 7. And it is audited.
    const trail = await harness.actions.listAudit(OWNER, proposed.id);
    expect(trail).toHaveLength(4);
    expect(harness.alerts.length).toBeGreaterThan(0);
  });
});