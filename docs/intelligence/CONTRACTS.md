# Intelligence Contracts

The stable interfaces Agent 1 (backend), Agent 3 (AI) and Agent 5 (frontend) code
against, and the event contracts between modules.

**Rules of engagement**

- Import from the module barrel only: `@/modules/analytics`, `@/modules/cash-flow`,
  `@/modules/profit-leaks`, `@/modules/simulator`, `@/modules/actions`,
  `@/modules/notifications`. Everything below `domain/`, `application/` and
  `infrastructure/` is internal.
- Never recompute a financial figure. Every number below is already final, in integer
  minor units, with its unit and period attached.
- Never read a tenant's data by supplying a tenant id. These services take
  `TenantContext` and derive the business from it.

---

## 1. Analytics — `@/modules/analytics`

```ts
getSnapshot(ctx, period): Promise<FinancialSnapshot>
getMetric(ctx, metric, period): Promise<FinancialMetric>
getDashboardMetrics(ctx, period): Promise<readonly FinancialMetric[]>
getPeriodComparison(ctx, period): Promise<PeriodComparison>
getRevenueBreakdown(ctx, period): Promise<readonly BreakdownItem[]>
getExpenseBreakdown(ctx, period): Promise<readonly BreakdownItem[]>
getProductPerformance(ctx, productId, period): Promise<ProductPerformance | null>
getRevenueConcentration(ctx, period, limit): Promise<readonly RevenueShare[]>
getOverdueReceivables(ctx, asOf): Promise<readonly OverdueReceivable[]>
getProductSales(ctx, period): Promise<readonly ProductSaleAggregate[]>
getPurchasePrices(ctx, period): Promise<ReadonlyMap<string, PurchasePriceAggregate>>
getProducts(ctx): Promise<readonly ProductAggregate[]>
getRecentlySoldProductIds(ctx, asOf): Promise<ReadonlySet<string>>
```

### For the AI layer

`getPeriodComparison` is the primary contract. It returns two complete snapshots plus
`deltas[]`, each with `currentValue`, `previousValue`, `changeBps`, `absoluteDelta`,
`direction` and `unit`. Hand the model those pairs and let it narrate them; it must not
divide anything.

`direction` is `'unavailable'` when a figure or its baseline is missing. **That is not
"no change"** — it means the figure could not be computed, and the model must say so.

### For the frontend

`BreakdownItem` carries `category`, `amount` (minor units), `percentage` and `count` for
charting. No recalculation needed.

### Zero versus unknown

- `readMetric(snapshot, name)` returns `undefined` for an unknown figure.
- `snapshot.unavailableMetrics` lists them.
- `FinancialMetric.unavailableReason` names the cause: `no_records_in_period`,
  `no_baseline_period`, `zero_denominator`, `missing_cost_data`,
  `incomplete_line_items`, `currency_mismatch`.

---

## 2. Cash flow — `@/modules/cash-flow`

```ts
forecast(ctx, period): Promise<CashFlowForecast>
getRisks(ctx): Promise<readonly CashFlowRisk[]>
getLatestForecast(ctx): Promise<CashFlowForecast | null>
getForecastById(ctx, forecastId): Promise<CashFlowForecast | null>
getUpcomingObligations(ctx, withinDays): Promise<UpcomingObligations>
```

Always surface `isProjection`, `assumptions[]` and `coverage`. Render line-level
`confidence` and `assumptionBased` so a merchant can see which numbers are observed and
which are assumed. `getUpcomingObligations` returns raw dated amounts and is therefore
the cheap option for an "amounts due" list.

---

## 3. Profit leaks — `@/modules/profit-leaks`

```ts
detectLeaks(ctx, period): Promise<readonly ProfitLeak[]>
analyze(ctx, period): Promise<LeakDetectionReport>
list(ctx, filters): Promise<PaginatedResult<ProfitLeak>>
getById(ctx, leakId): Promise<ProfitLeak | null>
getTotalImpact(ctx): Promise<{ total: number; leakCount: number }>
updateStatus(ctx, leakId, status): Promise<ProfitLeak>
```

`detectLeaks` returns leaks only, for simple consumers. **`analyze` is the contract to
build against**, because it additionally returns:

| Field | Why a consumer needs it |
|---|---|
| `suppressed[]` | Which detectors stayed quiet and why, so an absence is explained. |
| `detectorsUnavailable[]` | Which checks the schema cannot support, and the data they need. |
| `quality` | Whether the underlying figures were complete. |
| `totalImpactMinor` | Aggregate exposure in the period. |

Leak ids are deterministic, so `analyze` is safe to call repeatedly over the same period.

---

## 4. Simulator — `@/modules/simulator`

```ts
runScenario(ctx, period, input): Promise<Scenario>
getById(ctx, scenarioId): Promise<Scenario | null>
list(ctx, filters): Promise<PaginatedResult<Scenario>>
recompute(ctx, scenarioId): Promise<Scenario | null>
```

`Scenario` carries `isProjection: true`, `assumptions[]` (each with a `limitation`),
`comparison` and `cashTiming`. Render `cashTiming.affectsProfitAndLoss: false` explicitly
for a payment-timing or stock-order scenario: profit and loss are unchanged by design, and
only the cash outlay moves.

`status` is `'draft'` when any parameter was rejected. Render `rejections[]` rather than
hiding the projection, and **never clamp a rejected parameter silently** — the merchant
asked a different question than the one that was answered.

Supported parameters: `price_change`, `quantity_change`, `discount_change`, `cost_change`,
`expense_change`, `payment_timing`, `inventory_order`. Percentage changes are capped at
±100%; quantity at 1,000,000; delay at 365 days.

---

## 5. Actions — `@/modules/actions`

```ts
propose(ctx, input): Promise<Action>
draft(ctx, id): Promise<Action>
requestApproval(ctx, id): Promise<Action>
approve(ctx, id): Promise<Action>
reject(ctx, id, reason): Promise<Action>
cancel(ctx, id, reason?): Promise<Action>
execute(ctx, input): Promise<ExecutionOutcome>
getById(ctx, id): Promise<Action | null>
list(ctx, filters): Promise<PaginatedResult<Action>>
findPendingApproval(ctx): Promise<readonly Action[]>
listAudit(ctx, id): Promise<readonly ActionAuditEntry[]>
```

`execute` **returns** a denial rather than throwing, because a caller needs to tell
"refused, and here is why" from "the request was malformed". Read
`outcome.executed` and `outcome.denialReason`; the reason is one of the codes in
`ACTION_SECURITY.md` §9. Every denial is audited before the result returns.

`ActionService.approverRoles()` gives the roles permitted to approve, for rendering
controls.

**Read `ACTION_SECURITY.md` before wiring a route.** In particular: there is no
`approved -> cancelled` path, and a repeat execution is refused rather than repeated.

---

## 6. Notifications — `@/modules/notifications`

```ts
subscribeIntelligenceAlerts({ bus, sink, recipients, dedupe?, now }): () => void
```

Returns an unsubscribe function. The module declares no sibling dependencies, so it
reaches the intelligence layer only through the event bus. `AlertSink.deliver` must be
idempotent on `dedupeKey`; `AlertDedupeStore` suppresses repeats for
`ALERT_DEDUPE_WINDOW_MS` (24 hours).

Alerts carry a relative `actionUrl` (`/actions/<id>`), never an absolute URL, plus
`referenceId` linking back to the source finding.

---

## 7. Event contracts

Produced on the shared `EventBus` in `lib/events.ts`. **No new event types were added**;
the intelligence layer uses the existing vocabulary.

| Event | Produced by | Consumers should |
|---|---|---|
| `profit_leak.detected` | `ProfitLeakService.analyze` | Notify, dedupe on `leakId`. |
| `cash_flow.risk_detected` | the cash-flow caller that surfaces a risk | Notify on `riskType` + date. |
| `action.proposed` | `requestApproval` | Tell a human an action is waiting. |
| `action.approved` | `approve` | Informational. |
| `action.completed` | `execute` | Report the outcome; do **not** re-trigger execution. |

Handlers must be safe under retry. `analyze` is deterministic and idempotent, so
re-processing the same period is harmless.

---

## 8. Composition root

```ts
const db = getDatabaseClient();

const analytics = new PostgresAnalyticsService(
  new PostgresAnalyticsRepository(db.forTenant(...)),  // per-tenant client at call time
  systemClock,
);

const cashFlow = new PostgresCashFlowService(
  new PostgresCashFlowRepository(db.forTenant(...)),
  new PostgresCashFlowForecastStore(db),
  systemClock,
);

const profitLeaks = new PostgresProfitLeakService(
  new PostgresProfitLeakRepository(db),
  analytics,
  systemClock,
);

const simulator = new PostgresSimulatorService(
  new PostgresScenarioRepository(db),
  analytics,
  systemClock,
);

const registry = new ActionExecutorRegistry().register(/* ... */).freeze();
const actions = new PostgresActionService(
  new PostgresActionRepository(db),
  registry,
  systemClock,
  eventBus,
);

registerModule('analytics', analytics);
registerModule('cashFlow', cashFlow);
registerModule('profitLeaks', profitLeaks);
registerModule('simulator', simulator);
registerModule('actions', actions);
```

Repositories take a `TenantDatabaseClient`. The tenant id is also an explicit parameter on
every method, so scoping is belt-and-braces rather than implicit.

**Injected time is mandatory.** Every service takes a `Clock`. Passing `systemClock` in
production and `fixedClock` in tests is what makes approval expiry, leak `detectedAt` and
forecast horizons assertable instead of flaky.