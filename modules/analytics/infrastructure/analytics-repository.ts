import type { BusinessId, CurrencyCode } from '@/lib/types';
import type { HalfOpenPeriod } from '../domain/periods';
import type { SaleTotals } from '../domain/types';

/**
 * Read-only persistence contract for the analytics engine.
 *
 * Every method is tenant-scoped by an explicit `businessId` and by a half-open
 * period. The interface is deliberately read-only: the analytics layer is an
 * observer of business facts and must never be able to write to them, which is
 * what guarantees a metrics read cannot mutate production state.
 *
 * No method accepts a free-form SQL fragment, a column list, or a sort key
 * chosen by the caller. That keeps every query parameterized and index-aligned
 * regardless of what a route handler or an AI tool passes in.
 */
export interface AnalyticsRepository {
  /** Ledger totals for recognised sales, refunds and their derived cost. */
  getSaleTotals(businessId: BusinessId, period: HalfOpenPeriod): Promise<SaleTotals>;

  /** Total recognised operating expense in the period. */
  getOperatingExpenseTotal(businessId: BusinessId, period: HalfOpenPeriod): Promise<number>;

  /** Every recognised expense in the period, grouped by category. */
  getExpenseTotalsByCategory(
    businessId: BusinessId,
    period: HalfOpenPeriod,
  ): Promise<
    readonly {
      businessId: BusinessId;
      category: string;
      amountMinor: number;
      status: string;
      count: number;
    }[]
  >;

  /** Inventory valuation at current cost, plus the number of products counted. */
  getInventoryValuation(
    businessId: BusinessId,
  ): Promise<{ valueMinor: number; productCount: number }>;

  /** Open receivable and payable totals as of the period end. */
  getOpenBalances(
    businessId: BusinessId,
    asOf: Date,
  ): Promise<{
    receivablesMinor: number;
    payablesMinor: number;
    openReceivablesCount: number;
    overdueReceivablesMinor: number;
    openPayablesCount: number;
    hasReceivableRecords: boolean;
    hasPayableRecords: boolean;
  }>;

  /**
   * Ledger-derived cash as of an instant.
   *
   * `windowStart` bounds how far back the ledger is summed; callers pass the
   * earliest date they care about so the scan stays bounded even for a tenant
   * with a long history.
   */
  getLedgerCash(
    businessId: BusinessId,
    windowStart: Date,
    asOf: Date,
  ): Promise<{ openingCashMinor: number; salesReceivedMinor: number; customerPaymentsMinor: number; purchasePaidMinor: number; refundsPaidMinor: number; expensesPaidMinor: number; recognisedTransactionCount: number }>;

  /** Every open receivable with its due date, for the cash-flow projection. */
  getOpenReceivables(
    businessId: BusinessId,
    asOf: Date,
  ): Promise<
    readonly {
      readonly id: string;
      readonly customerId: string;
      readonly openMinor: number;
      readonly dueDate: Date;
      readonly daysOverdue: number;
    }[]
  >;

  /**
   * Open receivables past `thresholdDays`, with counterparty names.
   * The threshold is the business's own configured value.
   */
  getOverdueReceivables(
    businessId: BusinessId,
    asOf: Date,
    thresholdDays: number,
  ): Promise<
    readonly {
      readonly id: string;
      readonly customerId: string;
      readonly customerName: string;
      readonly openMinor: number;
      readonly daysOverdue: number;
    }[]
  >;

  /** Every open payable with its due date, for the cash-flow projection. */
  getOpenPayables(
    businessId: BusinessId,
    asOf: Date,
  ): Promise<
    readonly {
      readonly id: string;
      readonly supplierId: string;
      readonly openMinor: number;
      readonly dueDate: Date;
      readonly daysOverdue: number;
    }[]
  >;

  /** Recurring expenses with a known next due date, for obligation projection. */
  getRecurringExpenses(
    businessId: BusinessId,
  ): Promise<
    readonly {
      readonly id: string;
      readonly category: string;
      readonly amountMinor: number;
      readonly frequency: string;
      readonly nextDueDate: Date;
      readonly endDate: Date | null;
      readonly currency: string;
    }[]
  >;

  /** Non-recurring recognised expenses already dated inside the window. */
  getDatedExpenses(
    businessId: BusinessId,
    period: HalfOpenPeriod,
  ): Promise<readonly { readonly id: string; readonly category: string; readonly amountMinor: number; readonly expenseDate: Date }[]>;

  /** Currency and settings that drive reporting semantics. */
  getReportingSettings(
    businessId: BusinessId,
  ): Promise<{ currency: CurrencyCode; timezone: string; overdueThresholdDays: number }>;

  /** Actual per-product sale aggregates in the period. */
  getProductPerformance(
    businessId: BusinessId,
    productId: string,
    period: HalfOpenPeriod,
  ): Promise<ProductPerformanceRow | null>;

  /** Revenue grouped by counterparty, capped at `limit` rows. */
  getRevenueConcentration(
    businessId: BusinessId,
    period: HalfOpenPeriod,
    limit: number,
  ): Promise<readonly RevenueShareRow[]>;

  /** Sale-line aggregates for every product in the period, for leak detection. */
  getProductSalesInPeriod(
    businessId: BusinessId,
    period: HalfOpenPeriod,
  ): Promise<readonly ProductSalesRow[]>;

  /** Weighted average purchase unit price per product, per window. */
  getPurchasePrices(
    businessId: BusinessId,
    period: HalfOpenPeriod,
  ): Promise<readonly { productId: string; weightedUnitPriceMinor: number; quantity: number; lineCount: number }[]>;

  /** Active products with their stock, pricing and supplier, for stock analysis. */
  getProductsForAnalysis(
    businessId: BusinessId,
  ): Promise<
    readonly {
      readonly id: string;
      readonly name: string;
      readonly category: string | null;
      readonly status: string;
      readonly supplierId: string | null;
      readonly costPriceMinor: number;
      readonly sellingPriceMinor: number;
      readonly currentStock: number;
      readonly reorderPoint: number;
      readonly createdAt: Date;
    }[]
  >;
}

/** Per-product sale aggregate used by the performance and leak detectors. */
export interface ProductSalesRow {
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  readonly revenueMinor: number;
  readonly discountMinor: number;
  readonly cogsMinor: number;
  readonly uncostedLineCount: number;
  readonly lineCount: number;
}

/** Per-product realised performance for the period. */
export interface ProductPerformanceRow {
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  readonly revenueMinor: number;
  readonly cogsMinor: number;
  readonly uncostedLineCount: number;
  readonly lineCount: number;
}

/** One counterparty's revenue contribution. */
export interface RevenueShareRow {
  readonly counterpartyId: string;
  readonly counterpartyType: string;
  readonly revenueMinor: number;
  readonly transactionCount: number;
}