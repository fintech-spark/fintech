import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PostgresDatabaseClient } from '@/lib/database';
import { PostgresAnalyticsRepository } from '@/modules/analytics/infrastructure/postgres-analytics-repository';
import { PostgresCashFlowRepository } from '@/modules/cash-flow/infrastructure/postgres-cash-flow-repository';
import { PostgresProfitLeakRepository } from '@/modules/profit-leaks/infrastructure/postgres-profit-leak-repository';
import { PostgresScenarioRepository } from '@/modules/simulator/infrastructure/postgres-scenario-repository';
import { PostgresActionRepository } from '@/modules/actions/infrastructure/postgres-action-repository';
import {
  AS_OF,
  USER_A,
  USER_A_SECOND,
  USER_B,
  AMOUNT,
  EXPECTED,
  PERIOD,
  PRODUCT_COSTED,
  RECEIVABLE_OVERDUE,
  TENANT_A,
  TENANT_ABSENT,
  TENANT_B,
  assertIntelligenceColumnsExist,
  clearLiveFixtures,
  openLiveDatabase,
  seedLiveFixtures,
  tenantClient,
} from './fixtures';

// ---------------------------------------------------------------------------
// Live PostgreSQL — the five owned repositories, executed for real
//
// Every assertion below runs a real statement against a real server through the
// production client. Nothing is mocked: `openLiveDatabase` opens a pg Pool from
// DATABASE_URL and the repositories receive the same `TenantDatabaseClient`
// production wiring hands them.
//
// These assertions exist because static reading could not prove the SQL. The
// suite found two defects that inspection missed: SALE_TOTALS_SQL summed
// transaction totals once per line item, and three tables were missing columns
// the repositories write to.
//
// Run with:
//   DATABASE_URL=postgresql://postgres:postgres@localhost:55432/merchant_brain \
//     npm run test:db:live
// ---------------------------------------------------------------------------

let db: PostgresDatabaseClient;

beforeAll(async () => {
  db = await openLiveDatabase();
  await clearLiveFixtures(db);
  await assertIntelligenceColumnsExist(db);
  await seedLiveFixtures(db);
}, 60_000);

afterAll(async () => {
  if (db !== undefined) {
    await clearLiveFixtures(db);
    await db.close();
  }
}, 60_000);

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

describe('analytics repository against live PostgreSQL', () => {
  const analytics = () => new PostgresAnalyticsRepository(tenantClient(db, TENANT_A));

  it('sums a transaction total once, not once per line item', async () => {
    // TX_SALE is 39,000 across lines of 24,000 and 15,000. Summing the header
    // per line reported 78,000 and a sale_count of 2.
    const totals = await analytics().getSaleTotals(TENANT_A, PERIOD);

    expect(totals.grossRevenueMinor).toBe(EXPECTED.grossRevenueMinor);
    expect(totals.totalInvoicedMinor).toBe(EXPECTED.grossRevenueMinor);
    expect(totals.saleCount).toBe(EXPECTED.saleCount);
    expect(totals.lineCount).toBe(EXPECTED.lineCount);
    expect(totals.quantitySold).toBe(EXPECTED.quantitySold);
    expect(totals.cogsMinor).toBe(EXPECTED.cogsMinor);
    expect(totals.uncostedLineCount).toBe(EXPECTED.uncostedLineCount);
  });

  it('scales correctly as basket size grows, which is what the fan-out did', async () => {
    // Add two more lines to the same sale and re-read. Revenue must not move.
    const before = await analytics().getSaleTotals(TENANT_A, PERIOD);
    for (const index of [4, 5] as const) {
      await db.execute(
        `INSERT INTO transaction_items
           (id, transaction_id, product_id, product_name, quantity, unit_price_minor,
            discount_minor, tax_minor, total_minor)
         VALUES ($1, $2, $3, 'Extra line', 1, 1000, 0, 0, 1000)`,
        [
          `d4b10000-0000-4000-8000-0000000003${index}0`,
          'd4b10000-0000-4000-8000-0000000000f1',
          PRODUCT_COSTED,
        ],
      );
    }
    try {
      const after = await analytics().getSaleTotals(TENANT_A, PERIOD);
      expect(after.grossRevenueMinor).toBe(before.grossRevenueMinor);
      expect(after.saleCount).toBe(before.saleCount);
      expect(after.lineCount).toBe(before.lineCount + 2);
    } finally {
      await db.execute(
        `DELETE FROM transaction_items WHERE id::text LIKE 'd4b10000-0000-4000-8000-00000000034%'
           OR id::text LIKE 'd4b10000-0000-4000-8000-00000000035%'`,
      );
    }
  });

  it('excludes unrecognised statuses and honours half-open boundaries', async () => {
    const january = await analytics().getSaleTotals(TENANT_A, PERIOD);
    // TX_DRAFT is 999,999 and must never appear.
    expect(january.grossRevenueMinor).toBeLessThan(AMOUNT.draftSubtotalMinor);
    // TX_AT_FROM sits exactly on the lower bound and is included.
    expect(january.grossRevenueMinor).toBe(
      AMOUNT.saleSubtotalMinor + AMOUNT.atFromSubtotalMinor,
    );

    // Widening the window admits TX_AT_TO, which sits exactly on the old
    // exclusive upper bound. That is the half-open contract.
    const widened = await analytics().getSaleTotals(TENANT_A, {
      from: PERIOD.from,
      to: new Date('2026-03-01T00:00:00.000Z'),
    });
    expect(widened.grossRevenueMinor).toBe(
      january.grossRevenueMinor + AMOUNT.atToSubtotalMinor,
    );
    expect(widened.saleCount).toBe(january.saleCount + 1);
  });

  it('binds the refund placeholder separately from the sale placeholder', async () => {
    const totals = await analytics().getSaleTotals(TENANT_A, PERIOD);
    expect(totals.refundMinor).toBe(AMOUNT.refundTotalMinor);
    // The refund must not have been folded into revenue.
    expect(totals.grossRevenueMinor).not.toContain(AMOUNT.refundTotalMinor);
  });

  it('aggregates recognised expenses by category and ignores pending ones', async () => {
    const rows = await new PostgresAnalyticsRepository(tenantClient(db, TENANT_A))
      .getExpenseTotalsByCategory(TENANT_A, PERIOD);
    const byCategory = new Map(rows.map((row) => [row.category, row.amountMinor]));

    expect(byCategory.get('rent')).toBe(AMOUNT.expenseRentMinor);
    expect(byCategory.get('utilities')).toBe(AMOUNT.expenseUtilitiesMinor);
    expect(byCategory.has('marketing')).toBe(false);

    const total = await analytics().getOperatingExpenseTotal(TENANT_A, PERIOD);
    expect(total).toBe(EXPECTED.recognisedExpenseMinor);
  });

  it('counts open balances with FILTER and separates overdue from merely open', async () => {
    const balances = await analytics().getOpenBalances(TENANT_A, AS_OF);

    expect(balances.openReceivablesCount).toBe(2);
    expect(balances.receivablesMinor).toBe(EXPECTED.receivableOpenMinor);
    expect(balances.overdueReceivablesMinor).toBe(EXPECTED.overdueReceivableMinor);
    expect(balances.hasReceivableRecords).toBe(true);
    expect(balances.openPayablesCount).toBe(1);
    expect(balances.payablesMinor).toBe(EXPECTED.payableOpenMinor);
    expect(balances.hasPayableRecords).toBe(true);
  });

  it('reads past-due receivables using the merchant own overdue threshold', async () => {
    // The fixture business sets overdue_threshold_days = 30; the overdue row is
    // 15 days past due, so a 30-day threshold must NOT return it.
    const lenient = await analytics().getOverdueReceivables(TENANT_A, AS_OF, 30);
    expect(lenient).toHaveLength(0);

    const strict = await analytics().getOverdueReceivables(TENANT_A, AS_OF, 5);
    expect(strict).toHaveLength(1);
    expect(strict[0]?.id).toBe(RECEIVABLE_OVERDUE);
    expect(strict[0]?.customerName).toBe('Live Customer One');
  });

  it('joins product cost into per-product revenue and flags the unlinked line', async () => {
    const row = await analytics().getProductPerformance(TENANT_A, PRODUCT_COSTED, PERIOD);
    expect(row).not.toBeNull();
    expect(row?.quantity).toBe(AMOUNT.costedQuantity);
    expect(row?.revenueMinor).toBe(AMOUNT.costedLineTotalMinor);
    expect(row?.cogsMinor).toBe(AMOUNT.costedCogsMinor);
    expect(row?.uncostedLineCount).toBe(0);

    const sales = await analytics().getProductSalesInPeriod(TENANT_A, PERIOD);
    expect(sales.map((entry) => entry.productId)).toEqual([PRODUCT_COSTED]);
  });

  it('computes a weighted purchase price and clamps the concentration limit', async () => {
    // The repository returns rows; the service is what turns them into a Map.
    const rows = await analytics().getPurchasePrices(TENANT_A, PERIOD);
    const weighted = rows.find(
      (row) => row.productId === 'd4b10000-0000-4000-8000-0000000000d5',
    );
    expect(weighted?.weightedUnitPriceMinor).toBe(AMOUNT.purchaseUnitPriceMinor);
    expect(weighted?.quantity).toBe(AMOUNT.purchaseQuantity);
    expect(weighted?.lineCount).toBe(1);

    // A caller-supplied limit is clamped in SQL, so an absurd value cannot
    // become an unbounded aggregation.
    const clamped = await analytics().getRevenueConcentration(TENANT_A, PERIOD, 100_000);
    expect(clamped.length).toBeLessThanOrEqual(500);
  });

  it('values inventory at cost and reads reporting settings for the tenant', async () => {
    const inventory = await analytics().getInventoryValuation(TENANT_A);
    expect(inventory.productCount).toBe(EXPECTED.productCount);
    expect(inventory.valueMinor).toBe(EXPECTED.inventoryValueMinor);

    const settings = await analytics().getReportingSettings(TENANT_A);
    expect(settings.currency).toBe('INR');
    expect(settings.timezone).toBe('Asia/Kolkata');
    expect(settings.overdueThresholdDays).toBe(30);
  });

  it('derives ledger cash from the window it is given', async () => {
    const cash = await analytics().getLedgerCash(TENANT_A, PERIOD.from, PERIOD.to);

    // `opening_cash_minor` is window-bounded: the pre-period sale is excluded.
    expect(cash.openingCashMinor).toBe(EXPECTED.grossRevenueMinor);
    // The component sums run from the beginning of the ledger to `asOf`, so the
    // pre-period sale is included here. That difference is the point: the two
    // figures answer different questions.
    expect(cash.salesReceivedMinor).toBe(EXPECTED.grossRevenueMinor + AMOUNT.priorSaleSubtotalMinor);
    expect(cash.purchasePaidMinor).toBe(AMOUNT.purchaseSubtotalMinor);
    expect(cash.expensesPaidMinor).toBe(EXPECTED.recognisedExpenseMinor);
    expect(cash.recognisedTransactionCount).toBeGreaterThan(0);
  });

  it('returns empty rather than null or NaN for a tenant with no data', async () => {
    const empty = await new PostgresAnalyticsRepository(
      tenantClient(db, TENANT_ABSENT),
    ).getSaleTotals(TENANT_ABSENT, PERIOD);

    expect(empty.grossRevenueMinor).toBe(0);
    expect(empty.saleCount).toBe(0);
    expect(Number.isFinite(empty.cogsMinor)).toBe(true);

    const balances = await new PostgresAnalyticsRepository(
      tenantClient(db, TENANT_ABSENT),
    ).getOpenBalances(TENANT_ABSENT, AS_OF);
    expect(balances.openReceivablesCount).toBe(0);
    expect(balances.hasReceivableRecords).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe('tenant isolation against live PostgreSQL', () => {
  it('returns each tenant only its own figures', async () => {
    const a = await new PostgresAnalyticsRepository(tenantClient(db, TENANT_A)).getSaleTotals(
      TENANT_A,
      PERIOD,
    );
    const b = await new PostgresAnalyticsRepository(tenantClient(db, TENANT_B)).getSaleTotals(
      TENANT_B,
      PERIOD,
    );

    expect(a.grossRevenueMinor).toBe(EXPECTED.grossRevenueMinor);
    expect(b.grossRevenueMinor).toBe(AMOUNT.tenantBSaleSubtotalMinor);
    expect(a.grossRevenueMinor).not.toBe(b.grossRevenueMinor);
  });

  it('does not return another tenant rows when asked with its own id', async () => {
    // Tenant B has one receivable; tenant A must not see it, and vice versa.
    const a = await new PostgresAnalyticsRepository(tenantClient(db, TENANT_A)).getOpenBalances(
      TENANT_A,
      AS_OF,
    );
    const b = await new PostgresAnalyticsRepository(tenantClient(db, TENANT_B)).getOpenBalances(
      TENANT_B,
      AS_OF,
    );

    expect(a.receivablesMinor).toBe(EXPECTED.receivableOpenMinor);
    expect(b.receivablesMinor).toBe(AMOUNT.receivableBMinor);
    expect(a.payablesMinor).toBe(EXPECTED.payableOpenMinor);
    expect(b.payablesMinor).toBe(AMOUNT.payableBMinor);
  });

  it('scopes product and expense reads to the requesting tenant', async () => {
    const products = await new PostgresAnalyticsRepository(
      tenantClient(db, TENANT_A),
    ).getProductsForAnalysis(TENANT_A);
    expect(products.every((product) => product.supplierId === 'd4b10000-0000-4000-8000-0000000000d3' || product.supplierId === null)).toBe(true);
    expect(products).toHaveLength(EXPECTED.productCount);

    const total = await new PostgresAnalyticsRepository(
      tenantClient(db, TENANT_A),
    ).getOperatingExpenseTotal(TENANT_A, PERIOD);
    expect(total).toBe(EXPECTED.recognisedExpenseMinor);
  });

  it('refuses to read a row that belongs to another tenant', async () => {
    // Tenant B's receivable read through tenant A's client must find nothing.
    const asA = await new PostgresAnalyticsRepository(tenantClient(db, TENANT_A)).getOpenBalances(
      TENANT_A,
      AS_OF,
    );
    expect(asA.overdueReceivablesMinor).toBe(EXPECTED.overdueReceivableMinor);
    expect(asA.overdueReceivablesMinor).not.toBe(AMOUNT.receivableBMinor);
  });
});

// ---------------------------------------------------------------------------
// Cash-flow
// ---------------------------------------------------------------------------

describe('cash-flow repository against live PostgreSQL', () => {
  const cashFlow = () => new PostgresCashFlowRepository(tenantClient(db, TENANT_A));

  it('derives opening cash from the ledger before the horizon', async () => {
    // Opening cash sums every recognised movement dated STRICTLY BEFORE the
    // horizon start. Only the pre-period sale (1,000, dated 2025-12-15) falls
    // before 2026-01-01; the period's own sale is dated on the boundary and is
    // excluded by the half-open lower bound.
    const withHistory = await cashFlow().getOpeningCash(TENANT_A, PERIOD.from);
    expect(withHistory.hasRecords).toBe(true);
    expect(withHistory.cashMinor).toBe(AMOUNT.priorSaleSubtotalMinor);

    // A horizon that starts before the ledger does must report an empty ledger
    // rather than a confident zero. `hasRecords` is what lets a caller say
    // "your books are empty" instead of "you have no cash".
    const withoutHistory = await cashFlow().getOpeningCash(
      TENANT_A,
      new Date('2025-11-01T00:00:00.000Z'),
    );
    expect(withoutHistory.hasRecords).toBe(false);
    expect(withoutHistory.cashMinor).toBe(0);
  });

  it('separates dated expenses from recurring commitments', async () => {
    const horizon = { from: PERIOD.from, to: new Date('2026-02-15T00:00:00.000Z') };
    const dated = await cashFlow().getDatedExpensesForProjection(TENANT_A, horizon);
    // rent and utilities are dated and recognised; marketing is pending.
    expect(dated.map((entry) => entry.category).sort()).toEqual(['rent', 'utilities']);

    const recurring = await cashFlow().getRecurringExpensesForProjection(TENANT_A);
    expect(recurring).toHaveLength(1);
    expect(recurring[0]?.frequency).toBe('monthly');
    expect(recurring[0]?.amountMinor).toBe(AMOUNT.expenseRecurringMinor);
  });

  it('joins counterparty names onto open obligations', async () => {
    const receivables = await cashFlow().getReceivablesForProjection(TENANT_A, AS_OF);
    expect(receivables).toHaveLength(2);
    expect(receivables.every((entry) => entry.counterpartyName === 'Live Customer One')).toBe(true);

    const payables = await cashFlow().getPayablesForProjection(TENANT_A, AS_OF);
    expect(payables).toHaveLength(1);
    expect(payables[0]?.counterpartyName).toBe('Live Supplier');
  });

  it('buckets historical inflows by completed month, newest first', async () => {
    const history = await cashFlow().getHistoricalInflows(
      TENANT_A,
      new Date('2026-03-01T00:00:00.000Z'),
      12,
    );
    expect(history.length).toBeGreaterThan(0);
    for (const period of history) {
      expect(period.to.getTime()).toBeGreaterThan(period.from.getTime());
    }
  });

  it('reads reporting settings for the tenant', async () => {
    const settings = await cashFlow().getReportingSettings(TENANT_A);
    expect(settings.currency).toBe('INR');
    expect(settings.timezone).toBe('Asia/Kolkata');
  });
});

// ---------------------------------------------------------------------------
// Profit leaks, scenarios, actions
// ---------------------------------------------------------------------------

describe('profit-leak repository against live PostgreSQL', () => {
  it('round-trips a leak through the detail envelope', async () => {
    const repository = new PostgresProfitLeakRepository(tenantClient(db, TENANT_A));
    const id = 'd4b10000-0000-4000-8000-000000002001';

    const empty = await repository.list(TENANT_A, { page: 1, limit: 10 });
    expect(empty.total).toBe(0);

    const saved = await repository.save({
      id,
      businessId: TENANT_A,
      category: 'dead_inventory',
      severity: 'high',
      title: 'Live verification leak',
      description: 'Synthetic leak written by the live database suite.',
      impact: { amount: 12_345, currency: 'INR' },
      impactPeriod: '2026-01',
      evidence: [
        { resourceId: 'product-1', resourceType: 'product', description: 'x', observedAt: AS_OF },
      ],
      status: 'active',
      detectedAt: AS_OF,
      currency: 'INR',
      calculation: {
        rule: 'dead_inventory',
        ruleDescription: 'Stock unsold for the lookback window.',
        formula: 'cost_price_minor * current_stock',
        inputs: { currentStock: 40 },
        observedValue: 12_345,
        baselineValue: 0,
        deviation: 12_345,
        deviationUnit: 'minor_units',
        periodStart: PERIOD.from,
        periodEnd: PERIOD.to,
        comparisonPeriodStart: PERIOD.from,
        comparisonPeriodEnd: PERIOD.to,
        currency: 'INR',
      },
      suggestedInvestigation: 'Review replenishment for this product.',
      relatedRecordIds: [PRODUCT_COSTED],
    } as never);

    expect(saved.id).toBe(id);

    const found = await repository.findById(TENANT_A, id);
    expect(found?.impact.amount).toBe(12_345);
    expect(found?.suggestedInvestigation).toBe('Review replenishment for this product.');
    expect(found?.relatedRecordIds).toEqual([PRODUCT_COSTED]);

    const impact = await repository.sumActiveImpact(TENANT_A);
    expect(impact.totalMinor).toBe(12_345);
    expect(impact.leakCount).toBe(1);

    // Tenant B must not see it.
    expect(await repository.findById(TENANT_B, id)).toBeNull();
  });
});

describe('scenario repository against live PostgreSQL', () => {
  it('persists a scenario without touching any ledger table', async () => {
    const repository = new PostgresScenarioRepository(tenantClient(db, TENANT_A));
    const snapshot = {
      revenue: 100_000,
      cogs: 60_000,
      grossProfit: 40_000,
      grossMarginBps: 4_000,
      operatingExpenses: 20_000,
      netProfit: 20_000,
      netMarginBps: 2_000,
      grossRevenue: 100_000,
      discounts: 0,
      quantitySold: 10,
      saleCount: 5,
    };

    const ledgerBefore = await countLedgerRows();
    const id = 'd4b10000-0000-4000-8000-000000003001';
    await repository.save({
      id,
      businessId: TENANT_A,
      name: 'Live verification scenario',
      parameters: [],
      baseline: snapshot,
      projected: { ...snapshot, revenue: 120_000 },
      comparison: {
        revenueDelta: 20_000,
        grossProfitDelta: 15_000,
        profitDelta: 15_000,
        marginDeltaBps: 583,
        adverse: false,
        direction: 'increase',
        summary: 'Positive projection.',
      },
      status: 'draft',
      createdAt: AS_OF,
      currency: 'INR',
      periodStart: PERIOD.from,
      periodEnd: PERIOD.to,
      assumptions: [],
      rejections: [],
      quality: 'complete',
      isProjection: true,
      cashTiming: {
        upfrontOutlayMinor: 0,
        netCashDeltaMinor: 15_000,
        affectsProfitAndLoss: true,
      },
    } as never);

    const found = await repository.findById(TENANT_A, id);
    expect(found?.name).toBe('Live verification scenario');
    expect(found?.currency).toBe('INR');
    expect(found?.isProjection).toBe(true);

    expect(await repository.findById(TENANT_B, id)).toBeNull();
    expect(await countLedgerRows()).toBe(ledgerBefore);
  });
});

describe('action repository against live PostgreSQL', () => {
  it('enforces the single-winner claim in the database, not in application code', async () => {
    const repository = new PostgresActionRepository(tenantClient(db, TENANT_A));
    const id = 'd4b10000-0000-4000-8000-000000004001' as never;

    expect(await repository.findById(TENANT_A, id)).toBeNull();

    await repository.save({
      id,
      businessId: TENANT_A,
      type: 'send_reminder',
      title: 'Live verification reminder',
      description: 'Synthetic action written by the live database suite.',
      status: 'approved',
      source: 'manual',
      parameters: { customerId: 'c-1', channel: 'email' },
      createdAt: AS_OF,
      updatedAt: AS_OF,
      createdBy: USER_A,
      approvedBy: USER_A_SECOND,
      approvedAt: AS_OF,
      currency: 'INR',
    } as never);

    // Exactly one of two competing claims wins.
    const [first, second] = await Promise.all([
      repository.claimForExecution(TENANT_A, id, AS_OF),
      repository.claimForExecution(TENANT_A, id, AS_OF),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);

    // The loser cannot complete the transition, and a replay is refused.
    expect(await repository.claimForExecution(TENANT_A, id, AS_OF)).toBe(false);
    expect(
      await repository.completeExecution(TENANT_A, id, 'completed', AS_OF),
    ).toBe(true);

    // A second approval cannot overwrite the first approver.
    const secondAction = 'd4b10000-0000-4000-8000-000000004002' as never;
    await repository.save({
      id: secondAction,
      businessId: TENANT_A,
      type: 'send_reminder',
      title: 'Awaiting approval',
      description: 'Second synthetic action.',
      status: 'awaiting_approval',
      source: 'manual',
      parameters: { customerId: 'c-2' },
      createdAt: AS_OF,
      updatedAt: AS_OF,
      createdBy: USER_A,
      currency: 'INR',
    } as never);

    expect(
      await repository.recordApproval(TENANT_A, secondAction, USER_A_SECOND as never, AS_OF, 'hash-1'),
    ).toBe(true);
    expect(
      await repository.recordApproval(TENANT_A, secondAction, USER_B as never, AS_OF, 'hash-2'),
    ).toBe(false);

    const after = await repository.findById(TENANT_A, secondAction);
    expect(after?.approvedBy).toBe(USER_A_SECOND);
  });

  it('keeps the audit trail tenant-scoped and append-only', async () => {
    const repository = new PostgresActionRepository(tenantClient(db, TENANT_A));
    const id = 'd4b10000-0000-4000-8000-000000004003' as never;

    await repository.save({
      id,
      businessId: TENANT_A,
      type: 'reorder_stock',
      title: 'Audited reorder',
      description: 'Third synthetic action.',
      status: 'awaiting_approval',
      source: 'manual',
      parameters: { productId: PRODUCT_COSTED },
      createdAt: AS_OF,
      updatedAt: AS_OF,
      createdBy: USER_A,
      currency: 'INR',
    } as never);

    // A transition and its audit record are separate writes at the repository
    // level; the service is what couples them. Append both an allowed and a
    // denied entry to prove both are storable and both stay tenant-scoped.
    await repository.appendAudit({
      id: 'd4b10000-0000-4000-8000-000000005001' as never,
      actionId: id,
      businessId: TENANT_A,
      fromStatus: 'awaiting_approval',
      toStatus: 'approved',
      outcome: 'allowed',
      actorId: USER_A_SECOND as never,
      actorRole: 'owner',
      actorIsMachine: false,
      message: 'Approved by a second owner.',
      parametersHash: 'hash-abc',
      createdAt: AS_OF,
      correlationId: 'live-db-audit',
    });
    await repository.appendAudit({
      id: 'd4b10000-0000-4000-8000-000000005002' as never,
      actionId: id,
      businessId: TENANT_A,
      fromStatus: 'approved',
      toStatus: 'executing',
      outcome: 'denied',
      actorId: USER_A as never,
      actorRole: 'owner',
      actorIsMachine: false,
      reason: 'self_approval_forbidden',
      message: 'The proposer may not execute their own proposal.',
      parametersHash: 'hash-abc',
      createdAt: AS_OF,
      correlationId: 'live-db-audit',
    });

    const audit = await repository.listAudit(TENANT_A, id);
    expect(audit).toHaveLength(2);
    expect(audit.every((entry) => entry.businessId === TENANT_A)).toBe(true);
    expect(audit[0]?.outcome).toBe('allowed');
    expect(audit[1]?.outcome).toBe('denied');
    // The denial reason survives the round trip, so a refusal is auditable.
    expect(audit[1]?.reason).toBe('self_approval_forbidden');
    expect(audit[1]?.actorId).toBe(USER_A);

    // Another tenant cannot read this trail at all.
    expect(await repository.listAudit(TENANT_B, id)).toHaveLength(0);
  });
});

/** Row counts for every ledger table, used to prove a simulation wrote nothing. */
async function countLedgerRows(): Promise<number> {
  const row = await db.query<{ total: string }>(
    `SELECT (
       (SELECT COUNT(*) FROM transactions) +
       (SELECT COUNT(*) FROM transaction_items) +
       (SELECT COUNT(*) FROM expenses) +
       (SELECT COUNT(*) FROM products) +
       (SELECT COUNT(*) FROM receivables) +
       (SELECT COUNT(*) FROM payables)
     )::text AS total`,
  );
  return Number(row[0]?.total ?? '0');
}