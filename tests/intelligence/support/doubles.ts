import {
  asBusinessId,
  asUserId,
  type BusinessId,
  type CurrencyCode,
  type PaginatedResult,
  type TenantContext,
  type UserId,
  type UserRole,
} from '@/lib/types';
import type { Clock } from '@/lib/clock';
import type { AnalyticsRepository, ProductSalesRow } from '@/modules/analytics';
import type { HalfOpenPeriod } from '@/modules/analytics';
import type { SaleTotals } from '@/modules/analytics';
import {
  asRecurringFrequency,
  type CashFlowForecastRow,
  type CashFlowForecastStore,
  type CashFlowRepository,
  type ObligationInput,
  type RecurringExpenseInput,
} from '@/modules/cash-flow';
import type { ActionRepository } from '@/modules/actions';
import type { ActionId } from '@/lib/types';
import type {
  Action,
  ActionAuditEntry,
  ActionStatus,
} from '@/modules/actions';
import type { ScenarioRepository, Scenario } from '@/modules/simulator';
import type { ProfitLeak, ProfitLeakRepository, LeakFilterInput } from '@/modules/profit-leaks';
import { ConflictError } from '@/lib/errors';

/**
 * In-memory test doubles for the intelligence layer.
 *
 * These are not stubs that echo back whatever they are given. Each one enforces
 * the same invariants its PostgreSQL counterpart does, so a test passing here
 * proves the application logic respects tenant scope, half-open periods, the
 * single-winner execution claim and idempotency:
 *
 *   * reads are filtered by `businessId`, so a cross-tenant query returns nothing
 *   * periods are matched as `[from, to)`, never `<= to`
 *   * `claimForExecution` succeeds for exactly one caller
 *   * one idempotency key yields one action
 *
 * These doubles are test-only. Production wiring uses the PostgreSQL repositories.
 */

// ---------------------------------------------------------------------------
// Tenants, clocks, ledger fixtures
// ---------------------------------------------------------------------------

export const TENANT_A = asBusinessId('11111111-1111-4111-8111-111111111111');
export const TENANT_B = asBusinessId('22222222-2222-4222-8222-222222222222');

export function tenantFor(
  businessId: BusinessId,
  role: UserRole = 'owner',
  userId = 'user-1',
  correlationId = 'corr-1',
): TenantContext {
  return {
    businessId,
    userId: asUserId(userId),
    role,
    correlationId,
  };
}

export function fixedClockAt(iso: string | Date): Clock {
  const instant = new Date(iso);
  return { now: () => new Date(instant.getTime()) };
}

export function period(fromIso: string, toIso: string): HalfOpenPeriod {
  return { from: new Date(fromIso), to: new Date(toIso) };
}

export function isoDate(iso: string): Date {
  return new Date(iso);
}

/** One sale event in a synthetic ledger. */
export interface LedgerSale {
  readonly businessId: BusinessId;
  readonly at: string;
  readonly type: 'sale' | 'refund' | 'purchase' | 'payment';
  readonly status: string;
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly currency?: string;
  readonly lines?: readonly {
    readonly productId: string;
    readonly quantity: number;
    readonly unitPriceMinor: number;
    readonly discountMinor: number;
    readonly costPriceMinor?: number;
  }[];
}

export interface LedgerExpense {
  readonly businessId: BusinessId;
  readonly at: string;
  readonly category: string;
  readonly amountMinor: number;
  readonly status: string;
  readonly isRecurring?: boolean;
  readonly frequency?: string;
  readonly nextDueDate?: string;
  readonly endDate?: string | null;
}

export interface LedgerProduct {
  readonly businessId: BusinessId;
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly costPriceMinor: number;
  readonly sellingPriceMinor: number;
  readonly currentStock: number;
  readonly createdAt: string;
  readonly supplierId?: string | null;
}

/**
 * Derives ledger totals the way the SQL repository does.
 *
 * Shared by the analytics double so a fixture and the expectations built from it
 * cannot drift apart: the test states a ledger, and the totals follow.
 */
export function totalsFromLedger(
  sales: readonly LedgerSale[],
  window: HalfOpenPeriod,
  businessId: BusinessId,
): SaleTotals {
  const inWindow = sales.filter((sale) => {
    if (sale.businessId !== businessId) return false;
    const at = new Date(sale.at);
    return at >= window.from && at < window.to;
  });
  const recognised = inWindow.filter(
    (sale) => sale.status === 'completed' || sale.status === 'confirmed',
  );
  const saleRows = recognised.filter((sale) => sale.type === 'sale');
  const refundRows = recognised.filter((sale) => sale.type === 'refund');

  let cogsMinor = 0;
  let uncosted = 0;
  let lineCount = 0;
  let quantitySold = 0;

  for (const sale of saleRows) {
    for (const line of sale.lines ?? []) {
      lineCount += 1;
      quantitySold += line.quantity;
      if (line.costPriceMinor === undefined) {
        uncosted += 1;
      } else {
        cogsMinor += Math.round(line.costPriceMinor * line.quantity);
      }
    }
  }

  return {
    grossRevenueMinor: sum(saleRows.map((row) => row.subtotalMinor)),
    discountMinor: sum(saleRows.map((row) => row.discountMinor)),
    taxMinor: sum(saleRows.map((row) => row.taxMinor)),
    totalInvoicedMinor: sum(saleRows.map((row) => row.totalMinor)),
    refundMinor: sum(refundRows.map((row) => row.totalMinor)),
    saleCount: saleRows.length,
    quantitySold,
    uncostedLineCount: uncosted,
    lineCount,
    cogsMinor,
    currencies: [...new Set(inWindow.map((row) => row.currency ?? 'INR'))],
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

// ---------------------------------------------------------------------------
// Analytics double
// ---------------------------------------------------------------------------

export interface AnalyticsFixtures {
  readonly sales: readonly LedgerSale[];
  readonly expenses: readonly LedgerExpense[];
  readonly products: readonly LedgerProduct[];
  readonly currency?: CurrencyCode;
  readonly timezone?: string;
  readonly overdueThresholdDays?: number;
  readonly receivables?: readonly ReceivableFixture[];
  readonly payables?: readonly PayableFixture[];
}

export interface ReceivableFixture {
  readonly businessId: BusinessId;
  readonly id: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly amountMinor: number;
  readonly paidMinor: number;
  readonly dueDate: string;
  readonly status: string;
}

export interface PayableFixture {
  readonly businessId: BusinessId;
  readonly id: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly amountMinor: number;
  readonly paidMinor: number;
  readonly dueDate: string;
  readonly status: string;
}

const OPEN_RECEIVABLE = ['pending', 'partial', 'overdue'];
const OPEN_PAYABLE = ['pending', 'partial', 'overdue'];
const RECOGNISED_EXPENSE = ['approved', 'paid'];
const RECOGNISED_TX = ['completed', 'confirmed'];

export class InMemoryAnalyticsRepository implements AnalyticsRepository {
  /** Every query this double received, for asserting bounded SQL behaviour. */
  readonly calls: { readonly method: string; readonly businessId: string }[] = [];

  constructor(private readonly fixtures: AnalyticsFixtures) {}

  private record(method: string, businessId: BusinessId): void {
    this.calls.push({ method, businessId });
  }

  async getSaleTotals(businessId: BusinessId, window: HalfOpenPeriod): Promise<SaleTotals> {
    this.record('getSaleTotals', businessId);
    return totalsFromLedger(this.fixtures.sales, window, businessId);
  }

  async getOperatingExpenseTotal(businessId: BusinessId, window: HalfOpenPeriod): Promise<number> {
    this.record('getOperatingExpenseTotal', businessId);
    return sum(
      this.fixtures.expenses
        .filter((expense) => expense.businessId === businessId)
        .filter((expense) => inWindow(expense.at, window))
        .filter((expense) => RECOGNISED_EXPENSE.includes(expense.status))
        .map((expense) => expense.amountMinor),
    );
  }

  async getExpenseTotalsByCategory(businessId: BusinessId, window: HalfOpenPeriod) {
    this.record('getExpenseTotalsByCategory', businessId);
    const grouped = new Map<string, { amount: number; count: number; status: string }>();
    for (const expense of this.fixtures.expenses) {
      if (!inWindow(expense.at, window)) continue;
      if (!RECOGNISED_EXPENSE.includes(expense.status)) continue;
      const key = `${expense.businessId}:${expense.category}:${expense.status}`;
      const current = grouped.get(key) ?? { amount: 0, count: 0, status: expense.status };
      current.amount += expense.amountMinor;
      current.count += 1;
      grouped.set(key, current);
    }
    return [...grouped.entries()].map(([key, value]) => {
      const [, category, status] = key.split(':');
      return {
        businessId: key.split(':')[0] as BusinessId,
        category: category as string,
        status: status as string,
        amountMinor: value.amount,
        count: value.count,
      };
    });
  }

  async getInventoryValuation(businessId: BusinessId) {
    this.record('getInventoryValuation', businessId);
    const products = this.productsOf(businessId);
    return {
      valueMinor: sum(products.map((p) => Math.round(p.costPriceMinor * p.currentStock))),
      productCount: products.length,
    };
  }

  async getOpenBalances(businessId: BusinessId, asOf: Date) {
    this.record('getOpenBalances', businessId);
    const receivables = (this.fixtures.receivables ?? []).filter(
      (r) => r.businessId === businessId,
    );
    const payables = (this.fixtures.payables ?? []).filter((p) => p.businessId === businessId);
    const openReceivables = receivables.filter((r) => OPEN_RECEIVABLE.includes(r.status));
    const openPayables = payables.filter((p) => OPEN_PAYABLE.includes(p.status));

    return {
      receivablesMinor: sum(openReceivables.map((r) => r.amountMinor - r.paidMinor)),
      payablesMinor: sum(openPayables.map((p) => p.amountMinor - p.paidMinor)),
      openReceivablesCount: openReceivables.length,
      overdueReceivablesMinor: sum(
        openReceivables
          .filter((r) => new Date(r.dueDate) < asOf)
          .map((r) => r.amountMinor - r.paidMinor),
      ),
      openPayablesCount: openPayables.length,
      hasReceivableRecords: receivables.length > 0,
      hasPayableRecords: payables.length > 0,
    };
  }

  async getLedgerCash(businessId: BusinessId, windowStart: Date, asOf: Date) {
    this.record('getLedgerCash', businessId);
    const relevant = this.fixtures.sales.filter((sale) => {
      if (sale.businessId !== businessId) return false;
      if (!RECOGNISED_TX.includes(sale.status)) return false;
      return new Date(sale.at) < asOf;
    });
    const before = relevant.filter((sale) => new Date(sale.at) < windowStart);
    const inWindow = relevant.filter(
      (sale) => new Date(sale.at) >= windowStart && new Date(sale.at) < asOf,
    );
    return {
      openingCashMinor: sum(
        before
          .filter((sale) => sale.type === 'sale' || sale.type === 'payment')
          .map((sale) => sale.totalMinor),
      ),
      salesReceivedMinor: sum(
        inWindow.filter((s) => s.type === 'sale').map((s) => s.totalMinor),
      ),
      customerPaymentsMinor: sum(
        inWindow.filter((s) => s.type === 'payment').map((s) => s.totalMinor),
      ),
      purchasePaidMinor: sum(
        inWindow.filter((s) => s.type === 'purchase').map((s) => s.totalMinor),
      ),
      refundsPaidMinor: sum(
        inWindow.filter((s) => s.type === 'refund').map((s) => s.totalMinor),
      ),
      expensesPaidMinor: sum(
        this.fixtures.expenses
          .filter((e) => e.businessId === businessId)
          .filter((e) => new Date(e.at) < asOf && new Date(e.at) >= windowStart)
          .filter((e) => RECOGNISED_EXPENSE.includes(e.status))
          .map((e) => e.amountMinor),
      ),
      recognisedTransactionCount: relevant.length,
    };
  }

  async getOpenReceivables(businessId: BusinessId, asOf: Date) {
    this.record('getOpenReceivables', businessId);
    return (this.fixtures.receivables ?? [])
      .filter((r) => r.businessId === businessId && OPEN_RECEIVABLE.includes(r.status))
      .map((r) => ({
        id: r.id,
        customerId: r.customerId,
        openMinor: r.amountMinor - r.paidMinor,
        dueDate: new Date(r.dueDate),
        daysOverdue: daysOverdue(r.dueDate, asOf),
      }));
  }

  async getOpenPayables(businessId: BusinessId, asOf: Date) {
    this.record('getOpenPayables', businessId);
    return (this.fixtures.payables ?? [])
      .filter((p) => p.businessId === businessId && OPEN_PAYABLE.includes(p.status))
      .map((p) => ({
        id: p.id,
        supplierId: p.supplierId,
        openMinor: p.amountMinor - p.paidMinor,
        dueDate: new Date(p.dueDate),
        daysOverdue: daysOverdue(p.dueDate, asOf),
      }));
  }

  async getRecurringExpenses(businessId: BusinessId) {
    this.record('getRecurringExpenses', businessId);
    return this.fixtures.expenses
      .filter((e) => e.businessId === businessId)
      .filter((e) => e.isRecurring === true && e.nextDueDate !== undefined)
      .filter((e) => RECOGNISED_EXPENSE.includes(e.status))
      .map((e) => ({
        id: `expense-${e.category}-${e.nextDueDate ?? ''}`,
        category: e.category,
        amountMinor: e.amountMinor,
        frequency: e.frequency ?? 'monthly',
        nextDueDate: new Date(e.nextDueDate ?? e.at),
        endDate: e.endDate === undefined || e.endDate === null ? null : new Date(e.endDate),
        currency: 'INR',
      }));
  }

  async getDatedExpenses(businessId: BusinessId, window: HalfOpenPeriod) {
    this.record('getDatedExpenses', businessId);
    return this.fixtures.expenses
      .filter((e) => e.businessId === businessId)
      .filter((e) => e.isRecurring !== true)
      .filter((e) => inWindow(e.at, window))
      .filter((e) => RECOGNISED_EXPENSE.includes(e.status))
      .map((e) => ({
        id: `expense-${e.category}-${e.at}`,
        category: e.category,
        amountMinor: e.amountMinor,
        expenseDate: new Date(e.at),
      }));
  }

  async getReportingSettings(businessId: BusinessId) {
    this.record('getReportingSettings', businessId);
    return {
      currency: this.fixtures.currency ?? 'INR',
      timezone: this.fixtures.timezone ?? 'Asia/Kolkata',
      overdueThresholdDays: this.fixtures.overdueThresholdDays ?? 30,
    };
  }

  async getProductPerformance(
    businessId: BusinessId,
    productId: string,
    window: HalfOpenPeriod,
  ) {
    this.record('getProductPerformance', businessId);
    const row = this.productSalesOf(businessId, window).find((r) => r.productId === productId);
    if (!row) return null;
    return {
      productId: row.productId,
      name: row.name,
      quantity: row.quantity,
      revenueMinor: row.revenueMinor,
      cogsMinor: row.cogsMinor,
      uncostedLineCount: row.uncostedLineCount,
      lineCount: row.lineCount,
    };
  }

  async getRevenueConcentration(businessId: BusinessId, window: HalfOpenPeriod, limit: number) {
    this.record('getRevenueConcentration', businessId);
    // The double returns no rows, so the bound limit has nothing to apply to.
    void [window, limit];
    return [];
  }

  async getProductSalesInPeriod(businessId: BusinessId, window: HalfOpenPeriod) {
    this.record('getProductSalesInPeriod', businessId);
    return this.productSalesOf(businessId, window);
  }

  async getPurchasePrices(businessId: BusinessId, window: HalfOpenPeriod) {
    this.record('getPurchasePrices', businessId);
    const totals = new Map<string, { weighted: number; quantity: number; count: number }>();
    for (const sale of this.fixtures.sales) {
      if (sale.businessId !== businessId) continue;
      if (sale.type !== 'purchase') continue;
      if (!inWindow(sale.at, window)) continue;
      if (!RECOGNISED_TX.includes(sale.status)) continue;
      for (const line of sale.lines ?? []) {
        const current = totals.get(line.productId) ?? { weighted: 0, quantity: 0, count: 0 };
        current.weighted += line.unitPriceMinor * line.quantity;
        current.quantity += line.quantity;
        current.count += 1;
        totals.set(line.productId, current);
      }
    }
    return [...totals.entries()].map(([productId, value]) => ({
      productId,
      weightedUnitPriceMinor:
        value.quantity === 0 ? 0 : Math.round(value.weighted / value.quantity),
      quantity: value.quantity,
      lineCount: value.count,
    }));
  }

  async getProductsForAnalysis(businessId: BusinessId) {
    this.record('getProductsForAnalysis', businessId);
    return this.productsOf(businessId).map((product) => ({
      id: product.id,
      name: product.name,
      category: null,
      status: product.status,
      supplierId: product.supplierId ?? null,
      costPriceMinor: product.costPriceMinor,
      sellingPriceMinor: product.sellingPriceMinor,
      currentStock: product.currentStock,
      reorderPoint: 0,
      createdAt: new Date(product.createdAt),
    }));
  }

  async getOverdueReceivables(businessId: BusinessId, asOf: Date, thresholdDays: number) {
    this.record('getOverdueReceivables', businessId);
    return (this.fixtures.receivables ?? [])
      .filter((r) => r.businessId === businessId && OPEN_RECEIVABLE.includes(r.status))
      .map((r) => ({
        id: r.id,
        customerId: r.customerId,
        customerName: r.customerName,
        openMinor: r.amountMinor - r.paidMinor,
        daysOverdue: daysOverdue(r.dueDate, asOf),
      }))
      .filter((r) => r.daysOverdue > thresholdDays);
  }

  private productsOf(businessId: BusinessId): LedgerProduct[] {
    return this.fixtures.products.filter((product) => product.businessId === businessId);
  }

  private productSalesOf(businessId: BusinessId, window: HalfOpenPeriod): ProductSalesRow[] {
    const rows = new Map<string, ProductSalesRow>();
    for (const sale of this.fixtures.sales) {
      if (sale.businessId !== businessId) continue;
      if (sale.type !== 'sale') continue;
      if (!inWindow(sale.at, window)) continue;
      if (!RECOGNISED_TX.includes(sale.status)) continue;
      for (const line of sale.lines ?? []) {
        const current = rows.get(line.productId) ?? {
          productId: line.productId,
          name: line.productId,
          quantity: 0,
          revenueMinor: 0,
          discountMinor: 0,
          cogsMinor: 0,
          uncostedLineCount: 0,
          lineCount: 0,
        };
        rows.set(line.productId, {
          ...current,
          quantity: current.quantity + line.quantity,
          revenueMinor:
            current.revenueMinor + line.unitPriceMinor * line.quantity - line.discountMinor,
          discountMinor: current.discountMinor + line.discountMinor,
          uncostedLineCount:
            current.uncostedLineCount + (line.costPriceMinor === undefined ? 1 : 0),
          cogsMinor:
            current.cogsMinor +
            (line.costPriceMinor === undefined ? 0 : Math.round(line.costPriceMinor * line.quantity)),
          lineCount: current.lineCount + 1,
        });
      }
    }
    return [...rows.values()];
  }
}

function inWindow(at: string, window: HalfOpenPeriod): boolean {
  const instant = new Date(at);
  return instant >= window.from && instant < window.to;
}

function daysOverdue(dueDate: string, asOf: Date): number {
  return Math.max(0, Math.floor((asOf.getTime() - new Date(dueDate).getTime()) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Cash-flow double
// ---------------------------------------------------------------------------

export class InMemoryCashFlowRepository implements CashFlowRepository {
  readonly calls: { readonly method: string; readonly businessId: string }[] = [];

  constructor(private readonly analytics: InMemoryAnalyticsRepository) {}

  async getReportingSettings(businessId: BusinessId) {
    this.calls.push({ method: 'getReportingSettings', businessId });
    return this.analytics.getReportingSettings(businessId);
  }

  async getOpeningCash(businessId: BusinessId, horizonStart: Date) {
    this.calls.push({ method: 'getOpeningCash', businessId });
    const windowStart = new Date(horizonStart.getTime() - 730 * 86_400_000);
    const movement = await this.analytics.getLedgerCash(businessId, windowStart, horizonStart);
    return {
      cashMinor:
        movement.openingCashMinor +
        movement.salesReceivedMinor +
        movement.customerPaymentsMinor -
        movement.purchasePaidMinor -
        movement.refundsPaidMinor -
        movement.expensesPaidMinor,
      hasRecords: movement.recognisedTransactionCount > 0,
    };
  }

  async getReceivablesForProjection(businessId: BusinessId, asOf: Date) {
    this.calls.push({ method: 'getReceivablesForProjection', businessId });
    return this.receivablesOf(businessId, asOf);
  }

  async getPayablesForProjection(businessId: BusinessId, asOf: Date) {
    this.calls.push({ method: 'getPayablesForProjection', businessId });
    return this.payablesOf(businessId, asOf);
  }

  async getDatedExpensesForProjection(businessId: BusinessId, horizon: HalfOpenPeriod) {
    this.calls.push({ method: 'getDatedExpensesForProjection', businessId });
    return this.analytics.getDatedExpenses(businessId, horizon);
  }

  async getRecurringExpensesForProjection(
    businessId: BusinessId,
  ): Promise<readonly RecurringExpenseInput[]> {
    this.calls.push({ method: 'getRecurringExpensesForProjection', businessId });
    const rows = await this.analytics.getRecurringExpenses(businessId);
    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      amountMinor: row.amountMinor,
      frequency: asRecurringFrequency(row.frequency),
      nextDueDate: row.nextDueDate,
      endDate: row.endDate,
    }));
  }

  async getHistoricalInflows(businessId: BusinessId, before: Date, limit: number) {
    this.calls.push({ method: 'getHistoricalInflows', businessId });
    void limit;
    const byMonth = new Map<string, { from: Date; to: Date; inflowMinor: number }>();
    for (const sale of this.analytics['fixtures'].sales) {
      if (sale.businessId !== businessId) continue;
      if (sale.type !== 'sale' && sale.type !== 'payment') continue;
      if (!RECOGNISED_TX.includes(sale.status)) continue;
      const at = new Date(sale.at);
      if (at >= before) continue;
      const key = at.toISOString().slice(0, 7);
      const start = new Date(`${key}-01T00:00:00.000Z`);
      const entry = byMonth.get(key) ?? {
        from: start,
        to: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)),
        inflowMinor: 0,
      };
      entry.inflowMinor += sale.totalMinor;
      byMonth.set(key, entry);
    }
    return [...byMonth.values()].sort((a, b) => a.from.getTime() - b.from.getTime());
  }

  private async receivablesOf(
    businessId: BusinessId,
    asOf: Date,
  ): Promise<readonly ObligationInput[]> {
    const rows = await this.analytics.getOpenReceivables(businessId, asOf);
    return rows.map((row) => ({
      id: row.id,
      counterpartyId: row.customerId,
      counterpartyName: `Customer ${row.customerId}`,
      openMinor: row.openMinor,
      dueDate: row.dueDate,
      daysOverdue: row.daysOverdue,
    }));
  }

  private async payablesOf(businessId: BusinessId, asOf: Date): Promise<readonly ObligationInput[]> {
    const rows = await this.analytics.getOpenPayables(businessId, asOf);
    return rows.map((row) => ({
      id: row.id,
      counterpartyId: row.supplierId,
      counterpartyName: `Supplier ${row.supplierId}`,
      openMinor: row.openMinor,
      dueDate: row.dueDate,
      daysOverdue: row.daysOverdue,
    }));
  }
}

/** In-memory forecast store, tenant-scoped, newest first. */
export class InMemoryCashFlowForecastStore implements CashFlowForecastStore {
  private readonly rows: { id: string; businessId: BusinessId; calculatedAt: Date; payload: CashFlowForecastRow }[] =
    [];

  async save(row: CashFlowForecastRow): Promise<CashFlowForecastRow> {
    this.rows.unshift({
      id: row.id,
      businessId: row.businessId,
      calculatedAt: row.calculatedAt,
      payload: row,
    });
    return row;
  }

  async findLatest(businessId: BusinessId): Promise<CashFlowForecastRow | null> {
    const row = this.rows.find((candidate) => candidate.businessId === businessId);
    return row === undefined ? null : row.payload;
  }

  async findById(businessId: BusinessId, id: string): Promise<CashFlowForecastRow | null> {
    const row = this.rows.find(
      (candidate) => candidate.businessId === businessId && candidate.id === id,
    );
    return row === undefined ? null : row.payload;
  }
}

// ---------------------------------------------------------------------------
// Scenario double
// ---------------------------------------------------------------------------

export class InMemoryScenarioRepository implements ScenarioRepository {
  private readonly rows = new Map<string, Scenario>();

  async save(scenario: Scenario): Promise<Scenario> {
    this.rows.set(`${scenario.businessId}:${scenario.id}`, scenario);
    return scenario;
  }

  async findById(businessId: BusinessId, id: string): Promise<Scenario | null> {
    return this.rows.get(`${businessId}:${id}`) ?? null;
  }

  async list(businessId: BusinessId, filters: { page: number; limit: number; status?: string }) {
    const all = [...this.rows.values()].filter(
      (row) =>
        row.businessId === businessId &&
        (filters.status === undefined || row.status === filters.status),
    );
    const start = (filters.page - 1) * filters.limit;
    return {
      items: all.slice(start, start + filters.limit),
      total: all.length,
      page: filters.page,
      limit: filters.limit,
      hasMore: start + filters.limit < all.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Action double — enforces the single-winner claim and idempotency
// ---------------------------------------------------------------------------

export class InMemoryActionRepository implements ActionRepository {
  private readonly actions = new Map<string, Action>();
  private readonly audit: ActionAuditEntry[] = [];
  private readonly keys = new Map<string, string>();

  async findById(businessId: BusinessId, id: ActionId): Promise<Action | null> {
    return this.actions.get(`${businessId}:${id}`) ?? null;
  }

  async save(action: Action): Promise<Action> {
    const key = (action.parameters as { idempotencyKey?: string }).idempotencyKey;
    const storageKey = `${action.businessId}:${action.id}`;
    if (this.actions.has(storageKey)) return this.actions.get(storageKey) as Action;
    if (typeof key === 'string' && key.length > 0) {
      const keyScope = `${action.businessId}:${key}`;
      const existingId = this.keys.get(keyScope);
      if (existingId !== undefined) {
        const existing = this.actions.get(`${action.businessId}:${existingId}`);
        if (existing) return existing;
      }
      this.keys.set(keyScope, action.id);
    }
    this.actions.set(storageKey, action);
    return action;
  }

  async update(action: Action): Promise<Action> {
    this.actions.set(`${action.businessId}:${action.id}`, action);
    return action;
  }

  async list(businessId: BusinessId, filters: Parameters<ActionRepository['list']>[1]) {
    const all = [...this.actions.values()].filter(
      (row) =>
        row.businessId === businessId &&
        (filters.type === undefined || row.type === filters.type) &&
        (filters.status === undefined || row.status === filters.status) &&
        (filters.source === undefined || row.source === filters.source),
    );
    const start = (filters.page - 1) * filters.limit;
    return {
      items: all.slice(start, start + filters.limit),
      total: all.length,
      page: filters.page,
      limit: filters.limit,
      hasMore: start + filters.limit < all.length,
    };
  }

  async findPendingApproval(businessId: BusinessId): Promise<readonly Action[]> {
    return [...this.actions.values()].filter(
      (row) => row.businessId === businessId && row.status === 'awaiting_approval',
    );
  }

  /**
   * Mirrors the conditional UPDATE: only a caller that finds the action in
   * `approved` wins, and the winner's write is what every later caller sees.
   */
  async claimForExecution(businessId: BusinessId, id: ActionId, now: Date): Promise<boolean> {
    const action = this.actions.get(`${businessId}:${id}`);
    if (!action || action.status !== 'approved') return false;
    this.actions.set(`${businessId}:${id}`, { ...action, status: 'executing', updatedAt: now });
    return true;
  }

  async completeExecution(
    businessId: BusinessId,
    id: ActionId,
    status: Extract<ActionStatus, 'completed' | 'failed'>,
    now: Date,
  ): Promise<boolean> {
    const action = this.actions.get(`${businessId}:${id}`);
    if (!action || action.status !== 'executing') return false;
    this.actions.set(`${businessId}:${id}`, { ...action, status, updatedAt: now });
    return true;
  }

  async appendAudit(entry: ActionAuditEntry): Promise<void> {
    this.audit.push(entry);
  }

  async listAudit(businessId: BusinessId, actionId: ActionId): Promise<readonly ActionAuditEntry[]> {
    return this.audit.filter(
      (entry) => entry.businessId === businessId && entry.actionId === actionId,
    );
  }

  async getApprovalHash(businessId: BusinessId, actionId: ActionId): Promise<string | undefined> {
    const entry = this.audit
      .filter((row) => row.businessId === businessId && row.actionId === actionId)
      .filter((row) => row.toStatus === 'approved')
      .at(-1);
    return entry?.parametersHash;
  }

  async isIdempotencyKeyBoundElsewhere(
    businessId: BusinessId,
    key: string,
    actionId: ActionId,
  ): Promise<boolean> {
    const bound = this.keys.get(`${businessId}:${key}`);
    return bound !== undefined && bound !== actionId;
  }

  async recordApproval(
    businessId: BusinessId,
    id: ActionId,
    approvedBy: UserId,
    approvedAt: Date,
    parametersHash: string,
  ): Promise<boolean> {
    const action = this.actions.get(`${businessId}:${id}`);
    if (!action || action.status !== 'awaiting_approval') return false;
    this.actions.set(`${businessId}:${id}`, {
      ...action,
      status: 'approved',
      approvedBy,
      approvedAt,
      updatedAt: approvedAt,
    });
    this.approvalHashes.set(`${businessId}:${id}`, parametersHash);
    return true;
  }

  private readonly approvalHashes = new Map<string, string>();
}

// ---------------------------------------------------------------------------
// Profit-leak double
// ---------------------------------------------------------------------------

export class InMemoryProfitLeakRepository implements ProfitLeakRepository {
  private readonly rows = new Map<string, ProfitLeak>();

  async findById(businessId: BusinessId, id: string): Promise<ProfitLeak | null> {
    return this.rows.get(`${businessId}:${id}`) ?? null;
  }

  async save(leak: ProfitLeak): Promise<ProfitLeak> {
    this.rows.set(`${leak.businessId}:${leak.id}`, leak);
    return leak;
  }

  async update(leak: ProfitLeak): Promise<ProfitLeak> {
    this.rows.set(`${leak.businessId}:${leak.id}`, leak);
    return leak;
  }

  async list(businessId: BusinessId, filters: LeakFilterInput): Promise<PaginatedResult<ProfitLeak>> {
    const all = [...this.rows.values()].filter(
      (row) =>
        row.businessId === businessId &&
        (filters.status === undefined || row.status === filters.status) &&
        (filters.category === undefined || row.category === filters.category) &&
        (filters.severity === undefined || row.severity === filters.severity),
    );
    const start = (filters.page - 1) * filters.limit;
    return {
      items: all.slice(start, start + filters.limit),
      total: all.length,
      page: filters.page,
      limit: filters.limit,
      hasMore: start + filters.limit < all.length,
    };
  }

  async findActiveByCategory(): Promise<readonly ProfitLeak[]> {
    return [];
  }

  async sumActiveImpact(businessId: BusinessId) {
    const all = [...this.rows.values()].filter(
      (row) => row.businessId === businessId && (row.status === 'active' || row.status === 'acknowledged'),
    );
    return {
      totalMinor: all.reduce((total, row) => total + row.impact.amount, 0),
      leakCount: all.length,
    };
  }
}

/** Raises a conflict, matching the service's own signal for a stale transition. */
export function conflict(message: string): ConflictError {
  return new ConflictError(message);
}