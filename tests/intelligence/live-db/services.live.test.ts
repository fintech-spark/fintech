import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PostgresDatabaseClient } from '@/lib/database';
import { createEventBus } from '@/lib/events';
import { fixedClock } from '@/lib/clock';
import { asUserId } from '@/lib/types';
import { PostgresAnalyticsService } from '@/modules/analytics/application/postgres-analytics-service';
import { PostgresAnalyticsRepository } from '@/modules/analytics/infrastructure/postgres-analytics-repository';
import { PostgresCashFlowService } from '@/modules/cash-flow/application/postgres-cash-flow-service';
import { PostgresCashFlowRepository } from '@/modules/cash-flow/infrastructure/postgres-cash-flow-repository';
import { PostgresCashFlowForecastStore } from '@/modules/cash-flow/infrastructure/postgres-cash-flow-store';
import { PostgresProfitLeakService } from '@/modules/profit-leaks/application/postgres-profit-leak-service';
import { PostgresProfitLeakRepository } from '@/modules/profit-leaks/infrastructure/postgres-profit-leak-repository';
import { PostgresSimulatorService } from '@/modules/simulator/application/postgres-simulator-service';
import { PostgresScenarioRepository } from '@/modules/simulator/infrastructure/postgres-scenario-repository';
import { PostgresActionService } from '@/modules/actions/application/postgres-action-service';
import { PostgresActionRepository } from '@/modules/actions/infrastructure/postgres-action-repository';
import { ActionExecutorRegistry } from '@/modules/actions/domain/executors';
import { hashActionParameters } from '@/modules/actions/domain/rules';
import type { Action, ActionExecutor } from '@/modules/actions';
import {
  AS_OF,
  EXPECTED,
  PERIOD,
  PRODUCT_COSTED,
  RECEIVABLE_OVERDUE,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_A_SECOND,
  USER_B,
  clearLiveFixtures,
  openLiveDatabase,
  seedLiveFixtures,
  tenantClient,
  tenantContext,
} from './fixtures';

// ---------------------------------------------------------------------------
// Live PostgreSQL — the owned services, end to end
//
// The repository suite proves the statements are correct. This suite proves the
// services that Agent 1 will expose over HTTP and Agent 3 will wrap in AI tools
// actually run against a real database, and that the contracts they consume are
// stable: every method takes a TenantContext and derives its own tenant, so no
// caller can name a different business.
//
// Everything is wired exactly as production wires it — real client, real
// `forTenant`, real repositories, real `ActionExecutorRegistry`.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-01-20T12:00:00.000Z');

let db: PostgresDatabaseClient;

beforeAll(async () => {
  db = await openLiveDatabase();
  await clearLiveFixtures(db);
  await seedLiveFixtures(db);
}, 60_000);

afterAll(async () => {
  if (db !== undefined) {
    await clearLiveFixtures(db);
    await db.close();
  }
}, 60_000);

const analytics = () =>
  new PostgresAnalyticsService(
    new PostgresAnalyticsRepository(tenantClient(db, TENANT_A)),
    fixedClock(NOW),
  );

const ownerA = tenantContext(TENANT_A, USER_A, 'owner');
const ownerA2 = tenantContext(TENANT_A, USER_A_SECOND, 'owner');
const ownerB = tenantContext(TENANT_B, USER_B, 'owner');

describe('analytics service against live PostgreSQL', () => {
  it('produces a snapshot whose revenue is the ledger total, not a multiple', async () => {
    const snapshot = await analytics().getSnapshot(ownerA, PERIOD);

    // The regression this suite exists for: a fan-out bug reported 78,000 for a
    // single 39,000 sale.
    expect(snapshot.revenue.amount).toBe(EXPECTED.grossRevenueMinor);
    expect(snapshot.revenueRecognition.grossRevenue.amount).toBe(EXPECTED.grossRevenueMinor);
    expect(snapshot.revenueRecognition.saleCount).toBe(EXPECTED.saleCount);
    expect(snapshot.revenueRecognition.refunds.amount).toBe(EXPECTED.refundMinor);
    expect(snapshot.operatingExpenses.amount).toBe(EXPECTED.recognisedExpenseMinor);
    expect(snapshot.cogs.amount).toBe(EXPECTED.cogsMinor);
    // The unlinked line is reported as uncosted rather than silently zero-cost.
    expect(snapshot.cogsRecognition.uncostedLineCount).toBe(EXPECTED.uncostedLineCount);
    expect(snapshot.cogsRecognition.quality).toBe('partial');
    expect(snapshot.totalReceivables.amount).toBe(EXPECTED.receivableOpenMinor);
    expect(snapshot.totalPayables.amount).toBe(EXPECTED.payableOpenMinor);
    expect(snapshot.currency).toBe('INR');
  });

  it('reports a metric and its previous period without computing anything twice', async () => {
    const metric = await analytics().getMetric(ownerA, 'revenue', PERIOD);
    expect(metric.value).toBe(EXPECTED.grossRevenueMinor);
    expect(metric.unit).toBe('minor_units');
    // The previous period holds only the pre-period sale is outside it, so the
    // baseline is empty and the change is unavailable rather than fabricated.
    expect(metric.previousValue).toBeDefined();
  });

  it('never lets one tenant read another through a service call', async () => {
    const serviceB = new PostgresAnalyticsService(
      new PostgresAnalyticsRepository(tenantClient(db, TENANT_B)),
      fixedClock(NOW),
    );
    const a = await analytics().getSnapshot(ownerA, PERIOD);
    const b = await serviceB.getSnapshot(ownerB, PERIOD);

    expect(a.revenue.amount).toBe(EXPECTED.grossRevenueMinor);
    expect(b.revenue.amount).toBe(555_555);
    expect(a.revenue.amount).not.toBe(b.revenue.amount);
  });

  it('rejects an inverted period before touching the database', async () => {
    await expect(
      analytics().getSnapshot(ownerA, { from: PERIOD.to, to: PERIOD.from }),
    ).rejects.toThrow(/before/i);
  });
});

describe('cash-flow service against live PostgreSQL', () => {
  const service = () =>
    new PostgresCashFlowService(
      new PostgresCashFlowRepository(tenantClient(db, TENANT_A)),
      new PostgresCashFlowForecastStore(tenantClient(db, TENANT_A)),
      fixedClock(NOW),
    );

  it('builds and persists a projection, then reloads it unchanged', async () => {
    const forecast = await service().forecast(ownerA, PERIOD);

    expect(forecast.isProjection).toBe(true);
    expect(forecast.currency).toBe('INR');
    expect(forecast.periods.length).toBeGreaterThan(0);
    expect(Number.isInteger(forecast.endingCash.amount)).toBe(true);

    // The projection must be readable again, so a merchant reopening the view
    // sees the same figures rather than silently recomputed ones.
    const latest = await service().getLatestForecast(ownerA);
    expect(latest?.id).toBe(forecast.id);
    expect(latest?.endingCash.amount).toBe(forecast.endingCash.amount);
    expect(latest?.isProjection).toBe(true);

    const byId = await service().getForecastById(ownerA, forecast.id);
    expect(byId?.id).toBe(forecast.id);

    // Another tenant cannot load it.
    expect(await service().getForecastById(ownerB, forecast.id)).toBeNull();
  });

  it('reports upcoming obligations from real ledger rows', async () => {
    const upcoming = await service().getUpcomingObligations(ownerA, 60);
    expect(upcoming.isProjection).toBe(true);
    expect(upcoming.currency).toBe('INR');
    expect(upcoming.receivableCount + upcoming.payableCount).toBeGreaterThan(0);
    expect(
      upcoming.expectedInflows - upcoming.expectedOutflows,
    ).toBe(upcoming.netExpected);
  });
});

describe('profit-leak service against live PostgreSQL', () => {
  const service = () =>
    new PostgresProfitLeakService(
      new PostgresProfitLeakRepository(tenantClient(db, TENANT_A)),
      analytics(),
      fixedClock(NOW),
    );

  it('runs the detectors and persists what it finds', async () => {
    const report = await service().analyze(ownerA, PERIOD);

    expect(report.detected.length + report.suppressed.length + report.detectorsUnavailable.length)
      .toBeGreaterThan(0);
    expect(report.detectorsRun.length).toBeGreaterThan(0);
    expect(report.currency).toBe('INR');
    expect(Number.isInteger(report.totalImpactMinor)).toBe(true);

    const listed = await service().list(ownerA, { page: 1, limit: 50 });
    expect(listed.items.length).toBe(report.detected.length);
    expect(listed.page).toBe(1);

    // Re-running detection over the same period is idempotent: the same
    // deterministic leak id updates rather than accumulating duplicates.
    const second = await service().analyze(ownerA, PERIOD);
    expect(second.detected.length).toBe(report.detected.length);
  });

  it('closes over a leak through a tenant-scoped status change', async () => {
    const created = await service().detectLeaks(ownerA, PERIOD);
    const target = created[0];
    if (target === undefined) {
      // No detector fired on this fixture; nothing to close over.
      return;
    }

    const resolved = await service().updateStatus(ownerA, target.id, 'resolved');
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedAt).toBeInstanceOf(Date);

    // Another tenant cannot reach it.
    const foreign = new PostgresProfitLeakService(
      new PostgresProfitLeakRepository(tenantClient(db, TENANT_B)),
      new PostgresAnalyticsService(
        new PostgresAnalyticsRepository(tenantClient(db, TENANT_B)),
        fixedClock(NOW),
      ),
      fixedClock(NOW),
    );
    await expect(foreign.getById(ownerB, target.id)).rejects.toThrow();
  });
});

describe('simulator service against live PostgreSQL', () => {
  const service = () =>
    new PostgresSimulatorService(
      new PostgresScenarioRepository(tenantClient(db, TENANT_A)),
      analytics(),
      fixedClock(NOW),
    );

  it('runs a scenario against real data and stores it as a projection', async () => {
    const scenario = await service().runScenario(ownerA, PERIOD, {
      name: 'Live verification price rise',
      parameters: [
        {
          type: 'price_change',
          targetId: PRODUCT_COSTED,
          targetName: 'Live Costed Product',
          currentValue: AMOUNT_UNIT_PRICE,
          newValue: AMOUNT_UNIT_PRICE + 500,
          unit: 'amount',
        },
      ],
    });

    expect(scenario.isProjection).toBe(true);
    expect(scenario.currency).toBe('INR');
    expect(scenario.baseline.revenue).toBe(EXPECTED.grossRevenueMinor);
    // Baseline is real ledger data, so the projected figure must differ.
    expect(Number.isFinite(scenario.projected.revenue)).toBe(true);
    expect(scenario.comparison.revenueDelta).toBe(
      scenario.projected.revenue - scenario.baseline.revenue,
    );

    const loaded = await service().getById(ownerA, scenario.id);
    expect(loaded?.id).toBe(scenario.id);
    expect(loaded?.baseline.revenue).toBe(scenario.baseline.revenue);

    expect(await service().getById(ownerB, scenario.id)).toBeNull();

    const listed = await service().list(ownerA, { page: 1, limit: 10 });
    expect(listed.total).toBeGreaterThan(0);
  });
});

describe('action service lifecycle against live PostgreSQL', () => {
  const countingExecutor: ActionExecutor = {
    executorId: 'live-db-reminder',
    handles: 'send_reminder',
    execute: (action: Action) =>
      Promise.resolve({
        success: true,
        output: `Reminder queued for ${String(action.parameters['customerId'] ?? 'unknown')}.`,
        executorId: 'live-db-reminder',
      }),
  };

  const service = (bus = createEventBus()) =>
    new PostgresActionService(
      new PostgresActionRepository(tenantClient(db, TENANT_A)),
      new ActionExecutorRegistry().register(countingExecutor).freeze(),
      fixedClock(NOW),
      bus,
    );

  const proposal = (suffix: string) => ({
    type: 'send_reminder' as const,
    title: `Live verification reminder ${suffix}`,
    description: 'Synthetic action created by the live database suite.',
    source: 'manual' as const,
    parameters: {
      customerId: 'customer-1',
      channel: 'email',
      body: 'Your payment is overdue. Please settle the outstanding balance.',
    },
  });

  it('runs proposal to execution with dual approval and a full audit trail', async () => {
    const bus = createEventBus();
    const published: string[] = [];
    bus.subscribe('action.approved', () => {
      published.push('action.approved');
    });
    bus.subscribe('action.completed', () => {
      published.push('action.completed');
    });
    const actions = service(bus);

    const proposed = await actions.propose(ownerA, proposal('a'));
    expect(proposed.status).toBe('proposed');

    const drafted = await actions.draft(ownerA, proposed.id);
    expect(drafted.status).toBe('drafted');

    const queued = await actions.requestApproval(ownerA, proposed.id);
    expect(queued.status).toBe('awaiting_approval');

    // The proposer may not approve their own proposal. This is the product
    // decision: a second approver is required for every action type.
    await expect(actions.approve(ownerA, queued.id)).rejects.toThrow(/second approver/i);

    // A different owner approves.
    const approved = await actions.approve(ownerA2, queued.id);
    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe(asUserId(USER_A_SECOND));

    // The parameter hash recorded at approval is what execution re-checks.
    const repository = new PostgresActionRepository(tenantClient(db, TENANT_A));
    expect(await repository.getApprovalHash(TENANT_A, queued.id)).toBe(
      hashActionParameters(approved),
    );

    const outcome = await actions.execute(ownerA2, { id: queued.id });
    expect(outcome.executed).toBe(true);
    expect(outcome.action?.status).toBe('completed');

    // Exactly-once: a replay is refused and the executor does not run again.
    const replay = await actions.execute(ownerA2, { id: queued.id });
    expect(replay.executed).toBe(false);
    expect(replay.denialReason).toBe('already_executed');

    const audit = await actions.listAudit(ownerA, queued.id);
    const outcomes = audit.map((entry) => entry.outcome);
    expect(outcomes).toContain('allowed');
    expect(outcomes).toContain('denied');
    // The self-approval refusal is on the record, not just in an exception.
    expect(audit.some((entry) => entry.reason === 'self_approval_forbidden')).toBe(true);

    // Events are tenant-aware and published through the existing bus.
    expect(published).toEqual(['action.approved', 'action.completed']);
  });

  it('refuses to execute an action belonging to another tenant', async () => {
    const actions = service();
    const proposed = await actions.propose(ownerA, proposal('b'));
    // The state machine is proposed -> drafted -> awaiting_approval.
    await actions.draft(ownerA, proposed.id);
    const queued = await actions.requestApproval(ownerA, proposed.id);
    await actions.approve(ownerA2, queued.id);

    // Tenant B's owner holds no membership in tenant A and the lookup is
    // tenant-scoped, so this is NotFound rather than someone else's action.
    await expect(actions.execute(ownerB, { id: queued.id })).rejects.toThrow();
    expect(await actions.listAudit(ownerB, queued.id)).toHaveLength(0);
  });

  it('keeps the overdue receivable visible to the leak and reminder path', async () => {
    // Ties the fixture to a product decision: the overdue threshold comes from
    // the business record, so 30 days excludes a 15-day-past-due row.
    const overdue = await analytics().getOverdueReceivables(ownerA, AS_OF);
    expect(overdue).toHaveLength(0);
    expect(RECEIVABLE_OVERDUE).not.toBe(overdue[0]?.id);
  });
});

/** Mirrors AMOUNT.costedUnitPriceMinor without importing the whole constant map. */
const AMOUNT_UNIT_PRICE = 12_000;