import type { BusinessId, Money, DateRange } from '@/lib/types';
import type { HalfOpenPeriod } from './periods';

// ---------------------------------------------------------------------------
// Data quality — the explicit difference between "zero" and "unknown"
// ---------------------------------------------------------------------------

/**
 * How completely a figure is backed by source records.
 *
 * `insufficient_data` is a first-class outcome, never silently replaced with
 * zero. A merchant whose books hold no cost prices has an *unknown* gross
 * margin, and reporting `0%` there would understate their position and generate
 * false alarms downstream.
 */
export type DataQuality = 'complete' | 'partial' | 'insufficient_data';

/** Why a metric could not be produced. Surfaced verbatim to UI and AI layers. */
export type UnavailableReason =
  | 'no_records_in_period'
  | 'no_baseline_period'
  | 'zero_denominator'
  | 'missing_cost_data'
  | 'incomplete_line_items'
  | 'currency_mismatch';

/** Per-metric availability, so a consumer never reads a missing value as zero. */
export interface MetricAvailability {
  readonly unavailableMetrics: readonly MetricName[];
  readonly reasons: Readonly<Record<string, UnavailableReason>>;
}

// ---------------------------------------------------------------------------
// Transaction recognition
// ---------------------------------------------------------------------------

/**
 * Transaction statuses that count toward reported figures.
 *
 * `completed` and `confirmed` are recognised. `draft` is excluded because the
 * merchant has not committed to it, and `voided` is excluded because it was
 * cancelled. This is a product decision recorded here because the schema alone
 * does not imply it; changing it changes every reported number.
 */
export const RECOGNIZED_TRANSACTION_STATUSES = ['completed', 'confirmed'] as const;
export type RecognizedTransactionStatus = (typeof RECOGNIZED_TRANSACTION_STATUSES)[number];

export const SALE_TRANSACTION_TYPE = 'sale';
export const PURCHASE_TRANSACTION_TYPE = 'purchase';
export const PAYMENT_TRANSACTION_TYPE = 'payment';
export const REFUND_TRANSACTION_TYPE = 'refund';

/**
 * Expense statuses that count toward operating expense.
 *
 * `approved` and `paid` are recognised. `pending` is excluded because the
 * merchant has not committed to it, and `rejected` is excluded because it was
 * declined.
 */
export const RECOGNIZED_EXPENSE_STATUSES = ['approved', 'paid'] as const;
export type RecognizedExpenseStatus = (typeof RECOGNIZED_EXPENSE_STATUSES)[number];

/** Receivable and payable states that still represent money owed. */
export const OPEN_RECEIVABLE_STATUSES = ['pending', 'partial', 'overdue'] as const;
export const OPEN_PAYABLE_STATUSES = ['pending', 'partial', 'overdue'] as const;
/** Receivable states that no longer represent collectible money. */
export const CLOSED_RECEIVABLE_STATUSES = ['paid', 'written_off'] as const;

// ---------------------------------------------------------------------------
// Revenue recognition
// ---------------------------------------------------------------------------

/**
 * Aggregated sale-side totals for a period, straight out of the ledger.
 * All figures are integer minor units.
 */
export interface SaleTotals {
  /** Sum of `subtotal_minor`: list price before discount and before tax. */
  readonly grossRevenueMinor: number;
  /** Sum of `discount_minor` across recognised sales. */
  readonly discountMinor: number;
  /** Sum of `tax_minor` across recognised sales. Collected on behalf of others. */
  readonly taxMinor: number;
  /** Sum of `total_minor` across recognised sales. */
  readonly totalInvoicedMinor: number;
  /** Sum of `total_minor` across recognised refund transactions. */
  readonly refundMinor: number;
  /** Number of recognised sale transactions. The AOV denominator. */
  readonly saleCount: number;
  /** Sum of line-item quantity across recognised sales. */
  readonly quantitySold: number;
  /** Number of recognised sale line items that could not be costed. */
  readonly uncostedLineCount: number;
  /** Number of recognised sale line items in total. */
  readonly lineCount: number;
  /** Sum of derived cost of goods for costed lines. */
  readonly cogsMinor: number;
  /** Currencies present in the period. More than one blocks aggregation. */
  readonly currencies: readonly string[];
}

/**
 * The recognised revenue picture for one period.
 *
 * Definitions, all in integer minor units:
 *   grossRevenue        = Σ subtotal_minor            (list price, pre-discount, pre-tax)
 *   discounts           = Σ discount_minor
 *   netRevenue          = grossRevenue - discounts    (revenue actually earned, pre-tax)
 *   totalInvoiced       = netRevenue + tax            (what the customer paid)
 *   effectiveNetRevenue = netRevenue - refunds        (revenue retained after refunds)
 *
 * Tax is deliberately excluded from `netRevenue`: sales tax is collected for
 * the government, not earned by the merchant, and including it would inflate
 * both revenue and every margin derived from it.
 */
export interface RevenueRecognition {
  readonly grossRevenue: Money;
  readonly discounts: Money;
  readonly netRevenue: Money;
  readonly taxCollected: Money;
  readonly totalInvoiced: Money;
  readonly refunds: Money;
  readonly effectiveNetRevenue: Money;
  /** netRevenue as a share of grossRevenue, in bps. Undefined when nothing was sold. */
  readonly discountRateBps: number | undefined;
  /** refunds as a share of grossRevenue, in bps. Undefined when nothing was sold. */
  readonly refundRateBps: number | undefined;
  readonly saleCount: number;
  readonly quantitySold: number;
  readonly quality: DataQuality;
  readonly unavailableMetrics: readonly MetricName[];
}

/** Cost of goods derived for one period. */
export interface CogsRecognition {
  readonly cogs: Money;
  readonly costedLineCount: number;
  readonly uncostedLineCount: number;
  readonly quality: DataQuality;
}

// ---------------------------------------------------------------------------
// Reported figures
// ---------------------------------------------------------------------------

/**
 * The full deterministic picture of a period.
 *
 * Every monetary field is `Money` in integer minor units of the business
 * currency. Margin fields follow the repository convention of reporting `0` when
 * revenue is zero; use `unavailableMetrics` to tell that apart from a genuine
 * zero margin.
 */
export interface FinancialSnapshot {
  readonly businessId: BusinessId;
  readonly period: DateRange;
  readonly revenue: Money;
  readonly cogs: Money;
  readonly grossProfit: Money;
  readonly grossMarginBps: number;
  readonly operatingExpenses: Money;
  readonly netProfit: Money;
  readonly netMarginBps: number;
  readonly inventoryValue: Money;
  readonly totalReceivables: Money;
  readonly totalPayables: Money;
  readonly cashPosition: Money;
  readonly calculatedAt: Date;
  readonly currency: string;
  readonly quality: DataQuality;
  readonly unavailableMetrics: readonly MetricName[];
  readonly revenueRecognition: RevenueRecognition;
  readonly cogsRecognition: CogsRecognition;
  readonly expenseBreakdown: readonly ExpenseCategoryTotal[];
  readonly openReceivablesCount: number;
  readonly overdueReceivables: Money;
  readonly openPayablesCount: number;
  readonly productCount: number;
}

/** One metric with its immediately preceding equivalent period. */
export interface FinancialMetric {
  readonly name: MetricName;
  readonly value: number;
  readonly previousValue?: number;
  readonly changeBps?: number;
  readonly period: DateRange;
  readonly currency: string;
  readonly unit: MetricUnit;
  readonly quality: DataQuality;
  /** Present only when `value` could not be computed. */
  readonly unavailableReason?: UnavailableReason;
  /** The comparison window, so a change is always attributable. */
  readonly previousPeriod?: DateRange;
}

export type MetricName =
  | 'revenue'
  | 'cogs'
  | 'gross_profit'
  | 'net_profit'
  | 'gross_margin'
  | 'net_margin'
  | 'inventory_value'
  | 'receivables'
  | 'payables'
  | 'cash_position'
  | 'transaction_count'
  | 'average_order_value'
  | 'gross_revenue'
  | 'discounts'
  | 'refunds'
  | 'refund_rate'
  | 'working_capital'
  | 'expenses'
  | 'overdue_receivables'
  | 'quantity_sold';

/** How a metric's number should be rendered and reasoned about. */
export type MetricUnit = 'minor_units' | 'ratio_bps' | 'count' | 'quantity';

/** Expense total for one category, used for ratios and outlier detection. */
export interface ExpenseCategoryTotal {
  readonly category: string;
  readonly amountMinor: number;
  readonly count: number;
  readonly shareBps: number | undefined;
}

export type BreakdownItem = {
  readonly category: string;
  readonly amount: number;
  readonly percentage: number;
  readonly count: number;
};

export type { HalfOpenPeriod };

// ---------------------------------------------------------------------------
// Ledger-derived cash
// ---------------------------------------------------------------------------

/**
 * Cash movement aggregated from the ledger over an open-ended window.
 *
 * The schema has no bank or cash-account table, so cash is derived as the net
 * of every recognised cash-bearing transaction. This is a ledger proxy, not a
 * bank reconciliation, and `unreconciledOpeningBalance` is always `true` for it.
 */
export interface LedgerCashMovement {
  readonly from: Date;
  readonly to: Date;
  readonly openingCashMinor: number;
  readonly salesReceivedMinor: number;
  readonly customerPaymentsMinor: number;
  readonly purchasePaidMinor: number;
  readonly refundsPaidMinor: number;
  readonly expensesPaidMinor: number;
  readonly netMovementMinor: number;
  readonly closingCashMinor: number;
  readonly recognisedTransactionCount: number;
  readonly unreconciledOpeningBalance: boolean;
}