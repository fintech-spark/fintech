import type { TenantContext, DateRange } from '@/lib/types';
import type {
  BreakdownItem,
  DataQuality,
  FinancialMetric,
  FinancialSnapshot,
  MetricName,
  UnavailableReason,
} from '../domain/types';

/**
 * Application contract for the deterministic analytics engine.
 *
 * This is the only surface other modules, API routes and AI tools consume.
 * It exposes finished business answers in integer minor units, so a consumer
 * never re-derives a financial figure and never asks a model to compute one.
 *
 * Every method derives `businessId` from the supplied `TenantContext`. There is
 * no parameter through which a caller may name a different tenant, which is
 * what makes cross-tenant reads unreachable rather than merely discouraged.
 */
export interface AnalyticsService {
  /** Full deterministic picture for a period. */
  getSnapshot(ctx: TenantContext, period: DateRange): Promise<FinancialSnapshot>;

  /** One metric for a period, with its preceding equivalent period. */
  getMetric(ctx: TenantContext, metric: MetricName, period: DateRange): Promise<FinancialMetric>;

  /** The metrics a merchant dashboard needs, in a single read. */
  getDashboardMetrics(ctx: TenantContext, period: DateRange): Promise<readonly FinancialMetric[]>;

  /** Revenue split by month or day bucket, for charting. */
  getRevenueBreakdown(ctx: TenantContext, period: DateRange): Promise<readonly BreakdownItem[]>;

  /** Operating expense split by category. */
  getExpenseBreakdown(ctx: TenantContext, period: DateRange): Promise<readonly BreakdownItem[]>;

  /**
   * Snapshot for a period together with the immediately preceding equivalent
   * period and the derived deltas. This is the primary contract for the AI
   * layer: it hands over verified pairs of figures and lets the model narrate
   * them without computing anything.
   */
  getPeriodComparison(
    ctx: TenantContext,
    period: DateRange,
  ): Promise<PeriodComparison>;

  /**
   * Per-unit economics for one product, derived from actual sale lines.
   * Returns `null` when the product has no sales in the period, so a product
   * with no data is distinguishable from one with zero revenue.
   */
  getProductPerformance(
    ctx: TenantContext,
    productId: string,
    period: DateRange,
  ): Promise<ProductPerformance | null>;

  /**
   * Concentration of revenue across counterparties for the period, highest
   * share first. Used by the cash-flow and leak detectors and by the merchant
   * "am I dependent on one customer" question.
   */
  getRevenueConcentration(
    ctx: TenantContext,
    period: DateRange,
    limit: number,
  ): Promise<readonly RevenueShare[]>;

  /**
   * Open receivables past the business's own overdue threshold.
   * The threshold comes from the business record, not a hardcoded constant.
   */
  getOverdueReceivables(
    ctx: TenantContext,
    asOf: Date,
  ): Promise<readonly OverdueReceivable[]>;

  /** Per-product sale aggregates for a period, for leak detection. */
  getProductSales(ctx: TenantContext, period: DateRange): Promise<readonly ProductSaleAggregate[]>;

  /** Weighted purchase unit price per product for a period. */
  getPurchasePrices(
    ctx: TenantContext,
    period: DateRange,
  ): Promise<ReadonlyMap<string, PurchasePriceAggregate>>;

  /** Product master rows needed for stock and margin analysis. */
  getProducts(ctx: TenantContext): Promise<readonly ProductAggregate[]>;

  /** Ids of products sold within the trailing dead-stock window. */
  getRecentlySoldProductIds(ctx: TenantContext, asOf: Date): Promise<ReadonlySet<string>>;
}

/** An open receivable past its due date. */
export interface OverdueReceivable {
  readonly id: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly openMinor: number;
  readonly daysOverdue: number;
}

/** Per-product sale aggregate. */
export interface ProductSaleAggregate {
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  readonly revenueMinor: number;
  readonly cogsMinor: number;
}

/** Weighted average purchase price for one product. */
export interface PurchasePriceAggregate {
  readonly weightedUnitPriceMinor: number;
  readonly quantity: number;
}

/** Product row needed by stock and margin analysis. */
export interface ProductAggregate {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly supplierId: string | null;
  readonly costPriceMinor: number;
  readonly sellingPriceMinor: number;
  readonly currentStock: number;
  readonly createdAt: Date;
}

/** Two adjacent periods and the deterministic deltas between them. */
export interface PeriodComparison {
  readonly current: FinancialSnapshot;
  readonly previous: FinancialSnapshot;
  readonly previousPeriod: DateRange;
  readonly deltas: readonly MetricDelta[];
  readonly calculatedAt: Date;
}

/** Change in one metric between two periods, with its basis made explicit. */
export interface MetricDelta {
  readonly name: MetricName;
  readonly currentValue: number;
  readonly previousValue: number;
  /** Signed basis-point change, or `undefined` when the baseline is zero. */
  readonly changeBps: number | undefined;
  readonly absoluteDelta: number;
  readonly direction: 'increase' | 'decrease' | 'flat' | 'unavailable';
  readonly unit: FinancialMetric['unit'];
}

/** Actual per-unit economics for one product in a period. */
export interface ProductPerformance {
  readonly productId: string;
  readonly name: string;
  readonly unitsSold: number;
  readonly revenueMinor: number;
  readonly cogsMinor: number;
  readonly grossProfitMinor: number;
  readonly grossMarginBps: number;
  readonly unitRevenueMinor: number;
  readonly unitCostMinor: number;
  readonly quality: DataQuality;
  readonly unavailableReason?: UnavailableReason;
}

/** One counterparty's share of period revenue. */
export interface RevenueShare {
  readonly counterpartyId: string;
  readonly counterpartyType: string;
  readonly revenueMinor: number;
  readonly shareBps: number;
  readonly transactionCount: number;
}

export type { FinancialSnapshot, FinancialMetric, MetricName, BreakdownItem };