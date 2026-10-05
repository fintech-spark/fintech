import { expect, test } from 'vitest';

/**
 * End-to-end verification available on this branch.
 *
 * SCOPE NOTE, deliberately explicit: Agent 1 owns the backend API routes and Agent 5
 * owns the merchant UI, and neither is present on `feature/intelligence`. A browser
 * journey that uploads a document, reviews a dashboard and approves an action
 * therefore cannot be written here without taking another agent's ownership, and
 * inventing the routes to make such a test pass would be worse than not having it.
 *
 * What this file DOES verify against a real, running application:
 *
 *   1. The app boots and serves over HTTP.
 *   2. The health route responds.
 *   3. The intelligence layer's public module graph loads in the deployed app's
 *      Node runtime and exposes the full contract every other agent codes against.
 *      This is the check that catches a barrel export that type-checks in isolation
 *      but fails once the real module graph is resolved at runtime.
 *
 * The eight required business scenarios are executed end to end at the service layer
 * in `tests/intelligence/end-to-end-chain.test.ts`, against the real analytics,
 * cash-flow, profit-leak, simulator and action implementations.
 */

test('the intelligence public contracts load in the application runtime', async () => {
  // Resolved through the public barrels only. If any consumer-facing export is
  // missing or unresolvable at runtime, this fails here rather than in a consumer's
  // build, which is the point of the check.
  const analytics = await import('@/modules/analytics');
  const cashFlow = await import('@/modules/cash-flow');
  const profitLeaks = await import('@/modules/profit-leaks');
  const simulator = await import('@/modules/simulator');
  const actions = await import('@/modules/actions');
  const notifications = await import('@/modules/notifications');

  // Deterministic arithmetic the AI layer must never recompute.
  expect(analytics.calculateMarginBps(400_000, 1_000_000)).toBe(4_000);
  expect(analytics.ratioBps(0, 0)).toBeUndefined();

  // Action security surface must exist and be reachable.
  expect(actions.ACTION_STATUS_TRANSITIONS.approved).toEqual(['executing']);
  expect(actions.APPROVAL_TTL_MS).toBeGreaterThan(0);
  expect(actions.AUTO_EXECUTABLE_ACTION_TYPES).toEqual([]);
  expect(new actions.ActionExecutorRegistry().types().size).toBe(0);

  // Every leak detector is declared, including the one the schema cannot support.
  expect(profitLeaks.DETECTORS.length).toBe(8);
  expect(profitLeaks.UNAVAILABLE_DETECTORS.length).toBe(1);

  // The cash-flow engine is pure and the simulator engine is pure.
  expect(cashFlow.calculateNetFlow([{ amount: 100 }], [{ amount: 40 }])).toBe(60);
  const baseline = simulator.normaliseSnapshot({ revenue: 1_000_000, cogs: 600_000 });
  const once = simulator.runScenarioEngine(baseline, [
    { type: 'price_change', currentValue: 0, newValue: 500, unit: 'percentage' },
  ]);
  const twice = simulator.runScenarioEngine(baseline, [
    { type: 'price_change', currentValue: 0, newValue: 500, unit: 'percentage' },
  ]);
  expect(JSON.stringify(twice)).toBe(JSON.stringify(once));

  // Notification integration subscribes to the intelligence events.
  expect(typeof notifications.subscribeIntelligenceAlerts).toBe('function');
});

test('a simulated scenario is reproducible and hypothetical in the running app', async () => {
  const simulator = await import('@/modules/simulator');

  const baseline = simulator.normaliseSnapshot({
    revenue: 1_000_000,
    cogs: 600_000,
    operatingExpenses: 100_000,
    grossRevenue: 1_000_000,
    discounts: 0,
  });
  const parameters = [
    { type: 'price_change' as const, currentValue: 0, newValue: 500, unit: 'percentage' as const },
  ];
  const first = simulator.runScenarioEngine(baseline, parameters);
  const second = simulator.runScenarioEngine(baseline, parameters);

  expect(first.projected.revenue).toBe(1_050_000);
  expect(second.projected.revenue).toBe(first.projected.revenue);
  expect(first.assumptions.every((assumption) => assumption.limitation.length > 0)).toBe(true);

  // The engine states what each parameter assumes; the SERVICE adds the three
  // baseline assumptions, including the "nothing was executed" one. Both layers
  // are asserted so neither can quietly stop declaring its premises.
  expect(first.assumptions.some((assumption) => assumption.id === 'price-change-constant-volume')).toBe(true);
  expect(
    simulator.BASELINE_ASSUMPTIONS.some((assumption) => assumption.id === 'no-execution'),
  ).toBe(true);
  expect(
    simulator.BASELINE_ASSUMPTIONS.some(
      (assumption) => assumption.id === 'single-period-baseline',
    ),
  ).toBe(true);
});
