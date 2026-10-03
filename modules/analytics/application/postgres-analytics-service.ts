import { ValidationError } from '@/lib/errors';
import type { TenantContext, DateRange } from '@/lib/types';
import type { Clock } from '@/lib/clock';
import { ratioBps, sumMinorUnits } from '../domain/numeric';
import {
  chooseBucketGranularity,
  previousEquivalentPeriod,
  resolveReportingTimezone,
  splitIntoBuckets,
  toReportingDateLabel,
  type HalfOpenPeriod,
} from '../domain/periods';
import {
  buildFinancialSnapshot,
  snapshotMarginBps,
} from '../domain/rules';
import {
  expenseBreakdown,
  ledgerCashMovement,
  recognizeCogs,
  recognizeRevenue,
  workingCapitalMinor,
} from '../domain/revenue';
import type {
  BreakdownItem,
  FinancialMetric,
  FinancialSnapshot,
  MetricName,
  MetricUnit,
  UnavailableReason,
} from '../domain/types';
import type { AnalyticsRepository } from '../infrastructure/analytics-repository';
import type {
  AnalyticsService,
  MetricDelta,
  OverdueReceivable,
  PeriodComparison,
  ProductAggregate,
  ProductPerformance,
  ProductSaleAggregate,
  PurchasePriceAggregate,
  RevenueShare,
} from './service';

/**
 * Concrete analytics service.
 *
 * Two invariants are enforced structurally rather than by convention:
 *
 *  1. TENANT SCOPE. Every repository call uses `ctx.businessId`. No method
 *     accepts a business id, so a route handler or an AI tool cannot ask for
 *     another merchant's figures by passing one in.
 *  2. NO LLM ARITHMETIC. Every number returned here is computed from the
 *     repository by the pure functions in `domain/`. The service performs
 *     orchestration and validation only; it never estimates, rounds up, or
 *     fills a gap.
 */
export class PostgresAnalyticsService implements AnalyticsService {
  constructor(
    private readonly repository: AnalyticsRepository,
    private readonly clock: Clock,
  ) {}

  async getSnapshot(ctx: TenantContext, period: DateRange): Promise<FinancialSnapshot> {
    const validated = validatePeriod(period);
    const settings = await this.repository.getReportingSettings(ctx.businessId);
    const halfOpen = toHalfOpen(validated);
    const totals = await this.repository.getSaleTotals(ctx.businessId, halfOpen);
    const operatingExpensesMinor = await this.repository.getOperatingExpenseTotal(
      ctx.businessId,
      halfOpen,
    );
    const expenses = await this.repository.getExpenseTotalsByCategory(ctx.businessId, halfOpen);
    const inventory = await this.repository.getInventoryValuation(ctx.businessId);
    const balances = await this.repository.getOpenBalances(ctx.businessId, halfOpen.to);
    const cash = await this.getLedgerCash(ctx.businessId, halfOpen);

    const revenueRecognition = recognizeRevenue(totals, settings.currency);
    const cogsRecognition = recognizeCogs(totals, settings.currency);

    return buildFinancialSnapshot({
      businessId: ctx.businessId,
      period: validated,
      currency: settings.currency,
      revenueMinor: revenueRecognition.netRevenue.amount,
      cogsMinor: cogsRecognition.cogs.amount,
      operatingExpensesMinor,
      inventoryValueMinor: inventory.valueMinor,
      totalReceivablesMinor: balances.receivablesMinor,
      totalPayablesMinor: balances.payablesMinor,
      cashMinor: cash.closingCashMinor,
      revenueRecognition,
      cogsRecognition,
      expenseBreakdown: expenseBreakdown(
        ctx.businessId,
        expenses.map((entry) => ({
          businessId: entry.businessId,
          category: entry.category,
          amountMinor: entry.amountMinor,
          status: entry.status,
        })),
      ),
      openReceivablesCount: balances.openReceivablesCount,
      overdueReceivablesMinor: balances.overdueReceivablesMinor,
      openPayablesCount: balances.openPayablesCount,
      productCount: inventory.productCount,
      calculatedAt: this.clock.now(),
    });
  }

  async getMetric(
    ctx: TenantContext,
    metric: MetricName,
    period: DateRange,
  ): Promise<FinancialMetric> {
    const validated = validatePeriod(period);
    const previousPeriod = previousEquivalentPeriod(toHalfOpen(validated));
    const [current, previous] = await Promise.all([
      this.getSnapshot(ctx, validated),
      this.getSnapshot(ctx, toDateRange(previousPeriod)),
    ]);
    return buildMetric(current, previous, metric, validated, previousPeriod);
  }

  async getDashboardMetrics(
    ctx: TenantContext,
    period: DateRange,
  ): Promise<readonly FinancialMetric[]> {
    const validated = validatePeriod(period);
    const previousPeriod = previousEquivalentPeriod(toHalfOpen(validated));
    const [current, previous] = await Promise.all([
      this.getSnapshot(ctx, validated),
      this.getSnapshot(ctx, toDateRange(previousPeriod)),
    ]);

    return DASHBOARD_METRICS.map((metric) =>
      buildMetric(current, previous, metric, validated, previousPeriod),
    );
  }

  async getPeriodComparison(
    ctx: TenantContext,
    period: DateRange,
  ): Promise<PeriodComparison> {
    const validated = validatePeriod(period);
    const previousPeriod = previousEquivalentPeriod(toHalfOpen(validated));
    const [current, previous] = await Promise.all([
      this.getSnapshot(ctx, validated),
      this.getSnapshot(ctx, toDateRange(previousPeriod)),
    ]);

    return {
      current,
      previous,
      previousPeriod,
      deltas: DASHBOARD_METRICS.map((metric) =>
        buildDelta(current, previous, metric),
      ),
      calculatedAt: this.clock.now(),
    };
  }

  async getRevenueBreakdown(
    ctx: TenantContext,
    period: DateRange,
  ): Promise<readonly BreakdownItem[]> {
    return this.buildRevenueSeries(ctx, period);
  }

  async getExpenseBreakdown(
    ctx: TenantContext,
    period: DateRange,
  ): Promise<readonly BreakdownItem[]> {
    const validated = validatePeriod(period);
    const expenses = await this.repository.getExpenseTotalsByCategory(
      ctx.businessId,
      toHalfOpen(validated),
    );
    return toBreakdownItems(
      expenses.map((entry) => ({
        category: entry.category,
        amount: entry.amountMinor,
        count: entry.count,
      })),
    );
  }

  /**
   * Revenue per reporting bucket.
   *
   * Bucket size is derived from the requested span rather than accepted from the
   * caller, so a caller cannot request a day-level breakdown of a multi-year
   * range and force an unbounded scan.
   */
  private async buildRevenueSeries(
    ctx: TenantContext,
    period: DateRange,
  ): Promise<readonly BreakdownItem[]> {
    const validated = validatePeriod(period);
    const halfOpen = toHalfOpen(validated);
    const granularity = chooseBucketGranularity(halfOpen);
    const buckets = splitIntoBuckets(halfOpen, granularity);
    const settings = await this.repository.getReportingSettings(ctx.businessId);
    const timezone = resolveReportingTimezone(settings.timezone).timeZone;

    const series = await Promise.all(
      buckets.map(async (bucket) => {
        const totals = await this.repository.getSaleTotals(ctx.businessId, bucket);
        const recognised = recognizeRevenue(totals, settings.currency);
        return {
          category: describeBucket(bucket, granularity, timezone),
          amount: recognised.netRevenue.amount,
          count: recognised.saleCount,
        };
      }),
    );
return toBreakdownItems(series);
  }

  async getProductPerformance(
    ctx: TenantContext,
    productId: string,
    period: DateRange,
  ): Promise<ProductPerformance | null> {
    assertOpaqueId(productId, 'productId');
    const validated = validatePeriod(period);
    const row = await this.repository.getProductPerformance(
      ctx.businessId,
      productId,
      toHalfOpen(validated),
    );
    if (!row || row.lineCount === 0) return null;

    return buildProductPerformance(row);
  }

  async getRevenueConcentration(
    ctx: TenantContext,
    period: DateRange,
    limit: number,
  ): Promise<readonly RevenueShare[]> {
    const validated = validatePeriod(period);
    const totals = await this.repository.getSaleTotals(
      ctx.businessId,
      toHalfOpen(validated),
    );
    const rows = await this.repository.getRevenueConcentration(
      ctx.businessId,
      toHalfOpen(validated),
      clampLimit(limit),
    );
    const netRevenue = totals.grossRevenueMinor - totals.discountMinor - totals.refundMinor;

    return rows.map((row) => ({
      counterpartyId: row.counterpartyId,
      counterpartyType: row.counterpartyType,
      revenueMinor: row.revenueMinor,
      shareBps: ratioBps(row.revenueMinor, netRevenue) ?? 0,
      transactionCount: row.transactionCount,
    }));
  }


  async getOverdueReceivables(ctx: TenantContext, asOf: Date): Promise<readonly OverdueReceivable[]> {
    assertValidDate(asOf, 'asOf');
    const settings = await this.repository.getReportingSettings(ctx.businessId);
    const rows = await this.repository.getOverdueReceivables(
      ctx.businessId,
      asOf,
      settings.overdueThresholdDays,
    );
    return rows;
  }

  async getProductSales(
    ctx: TenantContext,
    period: DateRange,
  ): Promise<readonly ProductSaleAggregate[]> {
    const validated = validatePeriod(period);
    return this.repository.getProductSalesInPeriod(ctx.businessId, toHalfOpen(validated));
  }

  async getPurchasePrices(
    ctx: TenantContext,
    period: DateRange,
  ): Promise<ReadonlyMap<string, PurchasePriceAggregate>> {
    const validated = validatePeriod(period);
    const rows = await this.repository.getPurchasePrices(ctx.businessId, toHalfOpen(validated));
    return new Map(
      rows.map((row) => [row.productId, { weightedUnitPriceMinor: row.weightedUnitPriceMinor, quantity: row.quantity }]),
    );
  }

  async getProducts(ctx: TenantContext): Promise<readonly ProductAggregate[]> {
    return this.repository.getProductsForAnalysis(ctx.businessId);
  }

  /**
   * Products sold within the trailing dead-stock window.
   *
   * The window is fixed by `DEAD_STOCK_LOOKBACK_DAYS` in the leak rules rather
   * than supplied here, so every caller agrees on what "recently sold" means.
   */
  async getRecentlySoldProductIds(
    ctx: TenantContext,
    asOf: Date,
  ): Promise<ReadonlySet<string>> {
    assertValidDate(asOf, 'asOf');
    const windowStart = new Date(asOf.getTime() - DEAD_STOCK_LOOKBACK_DAYS * 86_400_000);
    const rows = await this.repository.getProductSalesInPeriod(ctx.businessId, {
      from: windowStart,
      to: asOf,
    });
    return new Set(rows.filter((row) => row.quantity > 0).map((row) => row.productId));
  }

  /**
   * Cash available to the merchant as of the period end.
   *
   * The ledger has no bank reconciliation, so the figure is a derived proxy over
   * a bounded window. The window is clamped to at most `MAX_CASH_WINDOW_DAYS` of
   * history so the scan stays bounded for a long-lived tenant.
   */
  private async getLedgerCash(
    businessId: TenantContext['businessId'],
    period: HalfOpenPeriod,
  ): Promise<{ closingCashMinor: number }> {
    const windowStart = new Date(
      period.to.getTime() - MAX_CASH_WINDOW_DAYS * 86_400_000,
    );
    const movement = await this.repository.getLedgerCash(businessId, windowStart, period.to);
    return ledgerCashMovement({
      from: windowStart,
      to: period.to,
      openingCashMinor: movement.openingCashMinor,
      salesReceivedMinor: movement.salesReceivedMinor,
      customerPaymentsMinor: movement.customerPaymentsMinor,
      purchasePaidMinor: movement.purchasePaidMinor,
      refundsPaidMinor: movement.refundsPaidMinor,
      expensesPaidMinor: movement.expensesPaidMinor,
      recognisedTransactionCount: movement.recognisedTransactionCount,
    });
  }
}

/** Metrics a merchant dashboard shows, in display order. */
export const DASHBOARD_METRICS: readonly MetricName[] = [
  'revenue',
  'gross_margin',
  'net_profit',
  'cogs',
  'expenses',
  'working_capital',
  'receivables',
  'payables',
  'overdue_receivables',
  'refunds',
  'average_order_value',
  'transaction_count',
];

/** Upper bound on the ledger window used for the derived cash position. */
export const MAX_CASH_WINDOW_DAYS = 730;

/** Trailing window used to decide whether stock has been idle. */
export const DEAD_STOCK_LOOKBACK_DAYS = 90;

function assertValidDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ValidationError(`${field} must be a valid Date.`);
  }
}

const METRIC_UNITS: Readonly<Record<MetricName, MetricUnit>> = {
  revenue: 'minor_units',
  gross_revenue: 'minor_units',
  discounts: 'minor_units',
  refunds: 'minor_units',
  cogs: 'minor_units',
  gross_profit: 'minor_units',
  net_profit: 'minor_units',
  expenses: 'minor_units',
  inventory_value: 'minor_units',
  receivables: 'minor_units',
  payables: 'minor_units',
  overdue_receivables: 'minor_units',
  working_capital: 'minor_units',
  cash_position: 'minor_units',
  gross_margin: 'ratio_bps',
  net_margin: 'ratio_bps',
  refund_rate: 'ratio_bps',
  transaction_count: 'count',
  quantity_sold: 'quantity',
  average_order_value: 'minor_units',
};

/** Upper bound on a concentration result set. */
const MAX_CONCENTRATION_LIMIT = 100;

// ---------------------------------------------------------------------------
// Snapshot extraction
// ---------------------------------------------------------------------------

/**
 * Reads one metric out of a snapshot.
 *
 * Returns `undefined` when the figure cannot be derived, which is how "zero"
 * stays distinguishable from "unknown" all the way to the UI and the model.
 */
export function readMetric(
  snapshot: FinancialSnapshot,
  metric: MetricName,
): number | undefined {
  if (snapshot.unavailableMetrics.includes(metric)) return undefined;
  switch (metric) {
    case 'revenue':
      return snapshot.revenue.amount;
    case 'gross_revenue':
      return snapshot.revenueRecognition.grossRevenue.amount;
    case 'discounts':
      return snapshot.revenueRecognition.discounts.amount;
    case 'refunds':
      return snapshot.revenueRecognition.refunds.amount;
    case 'refund_rate':
      return snapshot.revenueRecognition.refundRateBps;
    case 'cogs':
      return snapshot.cogs.amount;
    case 'gross_profit':
      return snapshot.grossProfit.amount;
    case 'net_profit':
      return snapshot.netProfit.amount;
    case 'expenses':
      return snapshot.operatingExpenses.amount;
    case 'gross_margin':
      return snapshot.revenue.amount === 0
        ? undefined
        : snapshotMarginBps(snapshot.grossProfit.amount, snapshot.revenue.amount);
    case 'net_margin':
      return snapshot.revenue.amount === 0
        ? undefined
        : snapshotMarginBps(snapshot.netProfit.amount, snapshot.revenue.amount);
    case 'inventory_value':
      return snapshot.inventoryValue.amount;
    case 'receivables':
      return snapshot.totalReceivables.amount;
    case 'payables':
      return snapshot.totalPayables.amount;
    case 'overdue_receivables':
      return snapshot.overdueReceivables.amount;
    case 'working_capital':
      return workingCapitalMinor({
        receivablesMinor: snapshot.totalReceivables.amount,
        payablesMinor: snapshot.totalPayables.amount,
        hasReceivableRecords: snapshot.openReceivablesCount > 0,
        hasPayableRecords: snapshot.openPayablesCount > 0,
      });
    case 'cash_position':
      return snapshot.cashPosition.amount;
    case 'transaction_count':
      return snapshot.revenueRecognition.saleCount;
    case 'quantity_sold':
      return snapshot.revenueRecognition.quantitySold;
    case 'average_order_value': {
      const { grossRevenue, discounts, refunds, saleCount } = snapshot.revenueRecognition;
      if (saleCount <= 0) return undefined;
      return Math.round(
        (grossRevenue.amount - discounts.amount - refunds.amount) / saleCount,
      );
    }
  }
}

function buildMetric(
  current: FinancialSnapshot,
  previous: FinancialSnapshot,
  metric: MetricName,
  period: DateRange,
  previousPeriod: HalfOpenPeriod,
): FinancialMetric {
  const currentValue = readMetric(current, metric);
  const previousValue = readMetric(previous, metric);
  const changeBps = buildDeltaValues(currentValue, previousValue).changeBps;

  const unavailableReason = resolveUnavailableReason(current, previous, metric);
  return {
    name: metric,
    value: currentValue ?? 0,
    ...(previousValue === undefined ? {} : { previousValue }),
    ...(changeBps === undefined ? {} : { changeBps }),
    period,
    currency: current.currency,
    unit: METRIC_UNITS[metric],
    quality: currentValue === undefined ? 'insufficient_data' : current.quality,
    ...(unavailableReason === undefined ? {} : { unavailableReason }),
    previousPeriod: toDateRange(previousPeriod),
  };
}

function buildDelta(
  current: FinancialSnapshot,
  previous: FinancialSnapshot,
  metric: MetricName,
): MetricDelta {
  const currentValue = readMetric(current, metric);
  const previousValue = readMetric(previous, metric);
  const delta = buildDeltaValues(currentValue, previousValue, metric);
  return {
    name: metric,
    currentValue: currentValue ?? 0,
    previousValue: previousValue ?? 0,
    changeBps: delta.changeBps,
    absoluteDelta: delta.absoluteDelta,
    direction: delta.direction,
    unit: METRIC_UNITS[metric],
  };
}

/**
 * Deterministic delta between two readings.
 *
 * `changeBps` is interpreted according to the metric's own unit:
 *
 *   * For a RATE metric (`gross_margin`, `net_margin`, `refund_rate`) the value
 *     is already a rate in bps, so `changeBps` is the ABSOLUTE move in bps.
 *     Reporting a relative change here would be actively misleading: a margin
 *     falling from 40% to 30% is a fall of 1,000 bps, not 2,500 bps, and only
 *     the absolute figure matches what a merchant means by "margin fell 10 points".
 *
 *   * For a LEVEL metric (money, counts) `changeBps` is the RELATIVE change,
 *     matching the repository's published `calculateChangeBps`.
 *
 * A missing figure, or a missing baseline, yields `direction: 'unavailable'`
 * rather than a fabricated percentage. That distinction is what stops the AI
 * layer from narrating "revenue is unchanged" when in fact revenue is unknown.
 */
export function buildDeltaValues(
  currentValue: number | undefined,
  previousValue: number | undefined,
  metric?: MetricName,
): {
  changeBps: number | undefined;
  absoluteDelta: number;
  direction: MetricDelta['direction'];
} {
  if (currentValue === undefined || previousValue === undefined) {
    return { changeBps: undefined, absoluteDelta: 0, direction: 'unavailable' };
  }
  const absoluteDelta = currentValue - previousValue;
  const isRate = metric !== undefined && METRIC_UNITS[metric] === 'ratio_bps';

  if (isRate) {
    return {
      changeBps: absoluteDelta,
      absoluteDelta,
      direction: absoluteDelta > 0 ? 'increase' : absoluteDelta < 0 ? 'decrease' : 'flat',
    };
  }

  if (previousValue === 0) {
    return {
      changeBps: undefined,
      absoluteDelta,
      direction: absoluteDelta === 0 ? 'flat' : absoluteDelta > 0 ? 'increase' : 'decrease',
    };
  }
  const changeBps = Math.round((absoluteDelta / Math.abs(previousValue)) * 10_000);
  return {
    changeBps,
    absoluteDelta,
    direction: absoluteDelta > 0 ? 'increase' : absoluteDelta < 0 ? 'decrease' : 'flat',
  };
}

function buildProductPerformance(row: {
  productId: string;
  name: string;
  quantity: number;
  revenueMinor: number;
  cogsMinor: number;
  uncostedLineCount: number;
  lineCount: number;
}): ProductPerformance {
  const quantity = row.quantity;
  const unitRevenue = quantity > 0 ? Math.round(row.revenueMinor / quantity) : 0;
  const unitCost = quantity > 0 ? Math.round(row.cogsMinor / quantity) : 0;
  const grossProfitMinor = row.revenueMinor - row.cogsMinor;
  const hasCost = row.uncostedLineCount === 0 && row.lineCount > 0;

  return {
    productId: row.productId,
    name: row.name,
    unitsSold: quantity,
    revenueMinor: row.revenueMinor,
    cogsMinor: row.cogsMinor,
    grossProfitMinor,
    grossMarginBps: snapshotMarginBps(grossProfitMinor, row.revenueMinor) ?? 0,
    unitRevenueMinor: unitRevenue,
    unitCostMinor: unitCost,
    quality: hasCost ? 'complete' : 'partial',
    ...(hasCost ? {} : { unavailableReason: 'missing_cost_data' as UnavailableReason }),
  };
}

// ---------------------------------------------------------------------------
// Validation and small helpers
// ---------------------------------------------------------------------------

export function validatePeriod(period: DateRange): DateRange {
  if (!(period instanceof Object) || period === null) {
    throw new ValidationError('A period with "from" and "to" dates is required.');
  }
  const from = period.from;
  const to = period.to;
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) {
    throw new ValidationError('Period "from" must be a valid Date.');
  }
  if (!(to instanceof Date) || Number.isNaN(to.getTime())) {
    throw new ValidationError('Period "to" must be a valid Date.');
  }
  if (from.getTime() >= to.getTime()) {
    throw new ValidationError('Period "from" must be strictly before "to".');
  }
  return period;
}

/**
 * Public periods use the same half-open convention as the rest of the layer, so
 * the conversion is the identity. It stays a named function so the convention is
 * stated in one place if it ever needs to change.
 */
export function toHalfOpen(period: DateRange): HalfOpenPeriod {
  return { from: period.from, to: period.to };
}

function toDateRange(period: HalfOpenPeriod): DateRange {
  return { from: period.from, to: period.to };
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return MAX_CONCENTRATION_LIMIT;
  return Math.min(MAX_CONCENTRATION_LIMIT, Math.max(1, Math.floor(limit)));
}

function assertOpaqueId(value: string, field: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new ValidationError(`${field} must be a non-empty identifier of at most 128 characters.`);
  }
}

function toBreakdownItems(
  entries: readonly { category: string; amount: number; count: number }[],
): BreakdownItem[] {
  const total = sumMinorUnits(entries.map((entry) => entry.amount));
  return entries.map((entry) => ({
    category: entry.category,
    amount: entry.amount,
    percentage: total === 0 ? 0 : Math.round((entry.amount / total) * 10_000) / 100,
    count: entry.count,
  }));
}

function describeBucket(bucket: HalfOpenPeriod, granularity: string, timezone: string): string {
  const label = toReportingDateLabel(bucket.from, timezone);
  return granularity === 'month' ? label.slice(0, 7) : label;
}

function resolveUnavailableReason(
  current: FinancialSnapshot,
  previous: FinancialSnapshot,
  metric: MetricName,
): UnavailableReason | undefined {
  if (readMetric(current, metric) !== undefined) return undefined;
  if (metric === 'average_order_value' || metric === 'gross_margin' || metric === 'net_margin') {
    return current.revenueRecognition.saleCount === 0 ? 'no_records_in_period' : 'zero_denominator';
  }
  if (previous.revenueRecognition.saleCount === 0 && current.revenueRecognition.saleCount > 0) {
    return 'no_baseline_period';
  }
  if (metric === 'cogs' || metric === 'gross_profit') return 'missing_cost_data';
  if (current.revenueRecognition.saleCount === 0) return 'no_records_in_period';
  return undefined;
}