import { createMoney, type BusinessId, type CurrencyCode, type Money } from '@/lib/types';
import {
  applyBpsToMinorUnits,
  assertMinorUnits,
  ratioBps,
  sumMinorUnits,
} from './numeric';
import {
  RECOGNIZED_EXPENSE_STATUSES,
  RECOGNIZED_TRANSACTION_STATUSES,
  REFUND_TRANSACTION_TYPE,
  SALE_TRANSACTION_TYPE,
  type CogsRecognition,
  type DataQuality,
  type ExpenseCategoryTotal,
  type MetricName,
  type RevenueRecognition,
  type SaleTotals,
} from './types';

// ---------------------------------------------------------------------------
// Status and type filters — the single source of truth for what counts
// ---------------------------------------------------------------------------

export function isRecognizedTransactionStatus(status: string): boolean {
  return (RECOGNIZED_TRANSACTION_STATUSES as readonly string[]).includes(status);
}

export function isRecognizedExpenseStatus(status: string): boolean {
  return (RECOGNIZED_EXPENSE_STATUSES as readonly string[]).includes(status);
}

/**
 * Effective unit cost in minor units for one sale line.
 *
 * `transaction_items` has no cost column, so the product's current
 * `cost_price_minor` is the only available basis. `undefined` means the line
 * could not be costed at all (an unlinked line or a product with no cost
 * record) and must propagate as unknown rather than as zero.
 */
export function lineCostMinor(input: {
  readonly unitPriceMinor: number;
  readonly quantity: number;
  readonly costPriceMinor?: number;
}): number | undefined {
  const { unitPriceMinor, quantity, costPriceMinor } = input;
  assertMinorUnits(unitPriceMinor, 'unitPriceMinor');
  if (!Number.isFinite(quantity) || quantity <= 0) return undefined;
  if (costPriceMinor === undefined) return undefined;
  assertMinorUnits(costPriceMinor, 'costPriceMinor');
  return applyBpsToMinorUnits(costPriceMinor, toBpsFromQuantity(quantity));
}

/**
 * Converts a fractional quantity into the bps multiplier used by
 * `applyBpsToMinorUnits`, so that `cost × quantity` rounds exactly once at the
 * end instead of accumulating per-unit rounding error.
 */
export function toBpsFromQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) {
    throw new RangeError(`Quantity must be finite, got ${quantity}.`);
  }
  return quantity * 10_000;
}

// ---------------------------------------------------------------------------
// Revenue recognition
// ---------------------------------------------------------------------------

/** Totals for a period with no recognised sales. The canonical zero baseline. */
export const EMPTY_SALE_TOTALS: SaleTotals = {
  grossRevenueMinor: 0,
  discountMinor: 0,
  taxMinor: 0,
  totalInvoicedMinor: 0,
  refundMinor: 0,
  saleCount: 0,
  quantitySold: 0,
  uncostedLineCount: 0,
  lineCount: 0,
  cogsMinor: 0,
  currencies: [],
};

/**
 * Turns raw ledger totals into the recognised revenue picture.
 *
 * Formulas (all integer minor units, all rounded once):
 *   grossRevenue        = Σ subtotal_minor
 *   discounts           = Σ discount_minor
 *   netRevenue          = grossRevenue - discounts
 *   taxCollected        = Σ tax_minor
 *   totalInvoiced       = netRevenue + taxCollected
 *   refunds             = Σ total_minor over recognised refund transactions
 *   effectiveNetRevenue = netRevenue - refunds
 *
 * Refunds are subtracted from revenue rather than reported separately, because a
 * refunded sale never produced revenue. The schema forbids a negative
 * `total_minor`, so a refund cannot be modelled as a negative sale row; netting
 * is the only representation that avoids double counting.
 */
export function recognizeRevenue(
  totals: SaleTotals,
  currency: CurrencyCode = 'INR',
): RevenueRecognition {
  assertRecognizableCurrency(totals.currencies, currency);

  const grossRevenueMinor = assertMinorUnits(totals.grossRevenueMinor, 'grossRevenueMinor');
  const discountMinor = assertMinorUnits(totals.discountMinor, 'discountMinor');
  const taxMinor = assertMinorUnits(totals.taxMinor, 'taxMinor');
  const refundMinor = assertMinorUnits(totals.refundMinor, 'refundMinor');

  const netRevenueMinor = grossRevenueMinor - discountMinor;
  const effectiveNetRevenueMinor = netRevenueMinor - refundMinor;

  const unavailable: MetricName[] = [];
  if (totals.saleCount === 0) unavailable.push('revenue', 'average_order_value', 'refund_rate');

  return {
    grossRevenue: createMoney(grossRevenueMinor, currency),
    discounts: createMoney(discountMinor, currency),
    netRevenue: createMoney(netRevenueMinor, currency),
    taxCollected: createMoney(taxMinor, currency),
    totalInvoiced: createMoney(netRevenueMinor + taxMinor, currency),
    refunds: createMoney(refundMinor, currency),
    effectiveNetRevenue: createMoney(effectiveNetRevenueMinor, currency),
    discountRateBps: ratioBps(discountMinor, grossRevenueMinor),
    refundRateBps: ratioBps(refundMinor, grossRevenueMinor),
    saleCount: totals.saleCount,
    quantitySold: totals.quantitySold,
    quality: totals.saleCount === 0 ? 'insufficient_data' : 'complete',
    unavailableMetrics: unavailable,
  };
}

/**
 * Mixed currencies in one period cannot be summed without an FX rate table,
 * which the schema does not provide. Refusing is the only correct behaviour:
 * adding INR minor units to USD minor units would fabricate a total.
 */
function assertRecognizableCurrency(
  currencies: readonly string[],
  businessCurrency: CurrencyCode,
): void {
  const foreign = currencies.filter((code) => code !== businessCurrency);
  if (foreign.length > 0) {
    throw new RangeError(
      `Period contains ${foreign.join(', ')} records while the business reports in ${businessCurrency}. ` +
        'Cross-currency aggregation is not supported because no FX rate table exists.',
    );
  }
}

/**
 * Cost of goods for a period, derived from product cost prices at time of read.
 *
 * Quality degrades honestly: `complete` when every sale line was costed,
 * `partial` when some were not, `insufficient_data` when none could be costed or
 * there were no sales at all. Gross margin built on a `partial` or
 * `insufficient_data` COGS must not be presented as authoritative.
 */
export function recognizeCogs(totals: SaleTotals, currency: CurrencyCode = 'INR'): CogsRecognition {
  const cogsMinor = assertMinorUnits(totals.cogsMinor, 'cogsMinor');
  const quality = resolveCogsQuality(totals);

  return {
    cogs: createMoney(cogsMinor, currency),
    costedLineCount: totals.lineCount - totals.uncostedLineCount,
    uncostedLineCount: totals.uncostedLineCount,
    quality,
  };
}

function resolveCogsQuality(totals: SaleTotals): DataQuality {
  if (totals.saleCount === 0) return 'insufficient_data';
  if (totals.lineCount === 0) return 'insufficient_data';
  if (totals.uncostedLineCount === 0) return 'complete';
  if (totals.uncostedLineCount >= totals.lineCount) return 'insufficient_data';
  return 'partial';
}

// ---------------------------------------------------------------------------
// Derived figures
// ---------------------------------------------------------------------------

/** Average order value in minor units. Undefined with no recognised sales. */
export function averageOrderValueMinor(totals: SaleTotals): number | undefined {
  if (totals.saleCount <= 0) return undefined;
  const netRevenueMinor = totals.grossRevenueMinor - totals.discountMinor - totals.refundMinor;
  return Math.round(netRevenueMinor / totals.saleCount);
}

/**
 * Operating expense total in minor units for one business.
 *
 * The `businessId` argument is not redundant with the SQL tenant filter: it makes
 * tenant scope structural here too, so a caller that assembles an expense list
 * from more than one source cannot silently total two merchants together.
 * `pending` and `rejected` expenses are excluded; see RECOGNIZED_EXPENSE_STATUSES.
 */
export function totalOperatingExpensesMinor(
  businessId: BusinessId,
  expenses: readonly { readonly businessId: BusinessId; readonly amountMinor: number; readonly status: string }[],
): number {
  return sumMinorUnits(
    expenses
      .filter((expense) => expense.businessId === businessId)
      .filter((expense) => isRecognizedExpenseStatus(expense.status))
      .map((expense) => expense.amountMinor),
  );
}

/**
 * Expense totals per category with each category's share of the total.
 * `shareBps` is undefined when nothing was spent, so the UI can show
 * "no expenses recorded" instead of "0% of expenses".
 */
export function expenseBreakdown(
  businessId: BusinessId,
  expenses: readonly {
    readonly businessId: BusinessId;
    readonly category: string;
    readonly amountMinor: number;
    readonly status: string;
  }[],
): readonly ExpenseCategoryTotal[] {
  const recognised = expenses
    .filter((expense) => expense.businessId === businessId)
    .filter((expense) => isRecognizedExpenseStatus(expense.status));
  const totalsByCategory = new Map<string, { amount: number; count: number }>();
  for (const expense of recognised) {
    const current = totalsByCategory.get(expense.category) ?? { amount: 0, count: 0 };
    current.amount += expense.amountMinor;
    current.count += 1;
    totalsByCategory.set(expense.category, current);
  }
  const grandTotal = sumMinorUnits(recognised.map((expense) => expense.amountMinor));
  return [...totalsByCategory.entries()]
    .map(([category, entry]) => ({
      category,
      amountMinor: entry.amount,
      count: entry.count,
      shareBps: ratioBps(entry.amount, grandTotal),
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor || a.category.localeCompare(b.category));
}

/** Open balance of a receivable or payable: total minus what has been paid. */
export function openBalanceMinor(input: {
  readonly amountMinor: number;
  readonly paidAmountMinor: number;
}): number {
  assertMinorUnits(input.amountMinor, 'amountMinor');
  assertMinorUnits(input.paidAmountMinor, 'paidAmountMinor');
  if (input.paidAmountMinor > input.amountMinor) {
    throw new RangeError(
      `Paid amount ${input.paidAmountMinor} exceeds outstanding amount ${input.amountMinor}.`,
    );
  }
  return input.amountMinor - input.paidAmountMinor;
}

/**
 * Working capital in minor units: what the merchant is owed minus what the
 * merchant owes. Positive means the merchant is funded by its own book.
 *
 * `undefined` when there is no receivable or payable data at all, which keeps an
 * unpopulated ledger from reporting a confident zero.
 */
export function workingCapitalMinor(input: {
  readonly receivablesMinor: number;
  readonly payablesMinor: number;
  readonly hasReceivableRecords: boolean;
  readonly hasPayableRecords: boolean;
}): number | undefined {
  if (!input.hasReceivableRecords && !input.hasPayableRecords) return undefined;
  return input.receivablesMinor - input.payablesMinor;
}

/** Inventory value at cost, in minor units. */
export function inventoryValueMinor(
  products: readonly { readonly currentStock: number; readonly costPriceMinor: number }[],
): number {
  return sumMinorUnits(products.map((product) => applyBpsToMinorUnits(
    product.costPriceMinor,
    toBpsFromQuantity(product.currentStock),
  )));
}

/**
 * Ledger-derived cash position: recognised cash in, recognised cash out.
 *
 * Every figure is a sum of `total_minor` on recognised transactions, classified
 * by `type`. This is a ledger proxy — there is no bank reconciliation in the
 * schema — so callers must surface `unreconciledOpeningBalance`.
 */
export function ledgerCashMovement(input: {
  readonly from: Date;
  readonly to: Date;
  readonly openingCashMinor: number;
  readonly salesReceivedMinor: number;
  readonly customerPaymentsMinor: number;
  readonly purchasePaidMinor: number;
  readonly refundsPaidMinor: number;
  readonly expensesPaidMinor: number;
  readonly recognisedTransactionCount: number;
}): {
  readonly netMovementMinor: number;
  readonly closingCashMinor: number;
} {
  const inflow = input.salesReceivedMinor + input.customerPaymentsMinor;
  const outflow =
    input.purchasePaidMinor + input.refundsPaidMinor + input.expensesPaidMinor;
  const netMovementMinor = inflow - outflow;
  return { netMovementMinor, closingCashMinor: input.openingCashMinor + netMovementMinor };
}

/** Convenience wrapper turning ledger sums into `Money`. */
export function toMoney(amountMinor: number, currency: CurrencyCode): Money {
  return createMoney(assertMinorUnits(amountMinor), currency);
}

export { SALE_TRANSACTION_TYPE, REFUND_TRANSACTION_TYPE };