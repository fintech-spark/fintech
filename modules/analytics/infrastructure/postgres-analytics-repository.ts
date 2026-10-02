import type { BusinessId, CurrencyCode } from '@/lib/types';
import type { TenantDatabaseClient } from '@/lib/database';
import type { HalfOpenPeriod } from '../domain/periods';
import {
  OPEN_PAYABLE_STATUSES,
  OPEN_RECEIVABLE_STATUSES,
  PURCHASE_TRANSACTION_TYPE,
  RECOGNIZED_EXPENSE_STATUSES,
  RECOGNIZED_TRANSACTION_STATUSES,
  REFUND_TRANSACTION_TYPE,
  SALE_TRANSACTION_TYPE,
  type SaleTotals,
} from '../domain/types';
import type { AnalyticsRepository, RevenueShareRow } from './analytics-repository';
import { EMPTY_SALE_TOTALS } from '../domain/revenue';

// PostgreSQL implementation of the analytics read model.
//
// Rules that hold for every statement in this file:
//   * `business_id = $1` is present in every query, and the tenant id is always a
//     bound parameter. Nothing is interpolated, so tenant isolation cannot be
//     bypassed by a crafted argument.
//   * Periods are bound as `[from, to)` half-open instants, matching the
//     reporting-period convention.
//   * Recognised statuses are expanded from the shared constants into fixed
//     placeholder lists; the parameter positions are computed, never concatenated.
//   * Every aggregation is a single grouped statement. No per-row queries, so no
//     N+1 pattern can appear here.
//   * Queries read only from ledger and master tables. This layer holds no write
//     path at all, so a metrics read cannot mutate business data.

/**
 * Formats a fixed set of strings as a PostgreSQL `text[]` bind literal.
 *
 * Values are validated rather than escaped: anything containing a quote, a
 * backslash, a brace or whitespace is rejected outright. These lists are internal
 * constants today, so a rejection can only mean a programming error, and refusing
 * is preferable to silently escaping a value into a different string than the one
 * the caller compared against.
 */
function asTextArrayLiteral(values: readonly string[]): string {
  for (const value of values) {
    if (!/^[A-Za-z0-9_]+$/.test(value)) {
      throw new RangeError(
        `Refusing to bind "${value}" as a status literal: only word characters are accepted.`,
      );
    }
  }
  return `{${values.map((value) => `"${value}"`).join(',')}}`;
}

export class PostgresAnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly db: TenantDatabaseClient) {}

  async getSaleTotals(businessId: BusinessId, period: HalfOpenPeriod): Promise<SaleTotals> {
    const rows = await this.db.query<SaleTotalsRow>(SALE_TOTALS_SQL, [
      businessId,
      period.from,
      period.to,
      SALE_TRANSACTION_TYPE,
      REFUND_TRANSACTION_TYPE,
      asTextArrayLiteral(RECOGNIZED_TRANSACTION_STATUSES),
    ]);
    return this.aggregateSaleTotals(rows);
  }

  /**
   * Folds per-line rows into a single period total.
   *
   * Cost is accumulated in SQL to avoid transferring every line item into
   * application memory; the returned `cogsMinor` is exact and already rounded
   * once per line by the same expression the domain layer uses.
   */
  private aggregateSaleTotals(rows: readonly SaleTotalsRow[]): SaleTotals {
    if (rows.length === 0) {
      return { ...EMPTY_SALE_TOTALS };
    }

    const aggregate = rows.reduce(
      (acc, row) => {
        acc.grossRevenueMinor += row.gross_revenue_minor ?? 0;
        acc.discountMinor += row.discount_minor ?? 0;
        acc.taxMinor += row.tax_minor ?? 0;
        acc.totalInvoicedMinor += row.total_invoiced_minor ?? 0;
        acc.refundMinor += row.refund_minor ?? 0;
        acc.saleCount += row.sale_count ?? 0;
        acc.quantitySold += row.quantity_sold ?? 0;
        acc.uncostedLineCount += row.uncosted_line_count ?? 0;
        acc.lineCount += row.line_count ?? 0;
        acc.cogsMinor += row.cogs_minor ?? 0;
        acc.currencies.push(row.currency);
        return acc;
      },
      {
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
        currencies: [] as string[],
      },
    );

    return { ...aggregate, currencies: [...new Set(aggregate.currencies)] };
  }

  async getOperatingExpenseTotal(
    businessId: BusinessId,
    period: HalfOpenPeriod,
  ): Promise<number> {
    const rows = await this.db.query<{ total_minor: number }>(
      OPERATING_EXPENSE_TOTAL_SQL,
      [businessId, period.from, period.to, asTextArrayLiteral(RECOGNIZED_EXPENSE_STATUSES)],
    );
    return rows[0]?.total_minor ?? 0;
  }

  async getExpenseTotalsByCategory(
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
  > {
    const rows = await this.db.query<ExpenseCategoryRow>(
      EXPENSE_BY_CATEGORY_SQL,
      [businessId, period.from, period.to, asTextArrayLiteral(RECOGNIZED_EXPENSE_STATUSES)],
    );
    return rows.map((row) => ({
      businessId,
      category: row.category,
      amountMinor: row.amount_minor,
      status: row.status,
      count: row.entry_count,
    }));
  }

  async getInventoryValuation(
    businessId: BusinessId,
  ): Promise<{ valueMinor: number; productCount: number }> {
    const rows = await this.db.query<InventoryValuationRow>(
      INVENTORY_VALUATION_SQL,
      [businessId],
    );
    return {
      valueMinor: rows[0]?.value_minor ?? 0,
      productCount: rows[0]?.product_count ?? 0,
    };
  }

  async getOpenBalances(
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
  }> {
    const [receivables, payables] = await Promise.all([
      this.db.query<OpenBalanceRow>(OPEN_RECEIVABLES_SQL, [
        businessId,
        asOf,
        asTextArrayLiteral(OPEN_RECEIVABLE_STATUSES),
      ]),
      this.db.query<OpenBalanceRow>(OPEN_PAYABLES_SQL, [
        businessId,
        asOf,
        asTextArrayLiteral(OPEN_PAYABLE_STATUSES),
      ]),
    ]);

    return {
      receivablesMinor: receivables[0]?.open_minor ?? 0,
      payablesMinor: payables[0]?.open_minor ?? 0,
      openReceivablesCount: receivables[0]?.open_count ?? 0,
      overdueReceivablesMinor: receivables[0]?.overdue_minor ?? 0,
      openPayablesCount: payables[0]?.open_count ?? 0,
      hasReceivableRecords: (receivables[0]?.record_count ?? 0) > 0,
      hasPayableRecords: (payables[0]?.record_count ?? 0) > 0,
    };
  }

  async getLedgerCash(
    businessId: BusinessId,
    windowStart: Date,
    asOf: Date,
  ): Promise<{
    openingCashMinor: number;
    salesReceivedMinor: number;
    customerPaymentsMinor: number;
    purchasePaidMinor: number;
    refundsPaidMinor: number;
    expensesPaidMinor: number;
    recognisedTransactionCount: number;
  }> {
    const rows = await this.db.query<LedgerCashRow>(LEDGER_CASH_SQL, [
      businessId,
      windowStart,
      asOf,
      asTextArrayLiteral(RECOGNIZED_TRANSACTION_STATUSES),
      asTextArrayLiteral(RECOGNIZED_EXPENSE_STATUSES),
    ]);
    const row = rows[0];
    return {
      openingCashMinor: row?.opening_cash_minor ?? 0,
      salesReceivedMinor: row?.sales_received_minor ?? 0,
      customerPaymentsMinor: row?.customer_payments_minor ?? 0,
      purchasePaidMinor: row?.purchase_paid_minor ?? 0,
      refundsPaidMinor: row?.refunds_paid_minor ?? 0,
      expensesPaidMinor: row?.expenses_paid_minor ?? 0,
      recognisedTransactionCount: row?.recognised_transaction_count ?? 0,
    };
  }

  async getOpenReceivables(businessId: BusinessId, asOf: Date) {
    const rows = await this.db.query<OpenObligationRow>(
      OPEN_RECEIVABLE_OBLIGATIONS_SQL,
      [businessId, asOf, asTextArrayLiteral(OPEN_RECEIVABLE_STATUSES), MAX_OBLIGATION_ROWS],
    );
    return rows.map(toReceivableObligation);
  }

  async getOverdueReceivables(businessId: BusinessId, asOf: Date, thresholdDays: number) {
    const rows = await this.db.query<OpenObligationRow>(
      OVERDUE_RECEIVABLES_SQL,
      [businessId, asOf, asTextArrayLiteral(OPEN_RECEIVABLE_STATUSES), thresholdDays, MAX_OBLIGATION_ROWS],
    );
    return rows.map((row) => ({
      id: row.id,
      customerId: row.counterparty_id,
      customerName: (row.counterparty_name ?? 'Unknown').slice(0, 200),
      openMinor: row.open_minor,
      daysOverdue: row.days_overdue,
    }));
  }

  async getOpenPayables(businessId: BusinessId, asOf: Date) {
    const rows = await this.db.query<OpenObligationRow>(
      OPEN_PAYABLE_OBLIGATIONS_SQL,
      [businessId, asOf, asTextArrayLiteral(OPEN_PAYABLE_STATUSES)],
    );
    return rows.map(toPayableObligation);
  }

  async getRecurringExpenses(businessId: BusinessId) {
    const rows = await this.db.query<RecurringExpenseRow>(
      RECURRING_EXPENSES_SQL,
      [businessId, asTextArrayLiteral(RECOGNIZED_EXPENSE_STATUSES)],
    );
    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      amountMinor: row.amount_minor,
      frequency: row.recurring_frequency ?? 'monthly',
      nextDueDate: row.recurring_next_due_date,
      endDate: row.recurring_end_date,
      currency: row.currency,
    }));
  }

  async getDatedExpenses(businessId: BusinessId, period: HalfOpenPeriod) {
    const rows = await this.db.query<DatedExpenseRow>(DATED_EXPENSES_SQL, [
      businessId,
      period.from,
      period.to,
      asTextArrayLiteral(RECOGNIZED_EXPENSE_STATUSES),
    ]);
    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      amountMinor: row.amount_minor,
      expenseDate: row.expense_date,
    }));
  }

  async getReportingSettings(businessId: BusinessId) {
    const rows = await this.db.query<ReportingSettingsRow>(
      REPORTING_SETTINGS_SQL,
      [businessId],
    );
    const row = rows[0];
    return {
      currency: (row?.currency ?? 'INR') as CurrencyCode,
      timezone: row?.timezone ?? 'Asia/Kolkata',
      overdueThresholdDays: row?.overdue_threshold_days ?? 30,
    };
  }

  async getProductPerformance(
    businessId: BusinessId,
    productId: string,
    period: HalfOpenPeriod,
  ) {
    const rows = await this.db.query<ProductPerformanceSqlRow>(
      PRODUCT_PERFORMANCE_SQL,
      [
        businessId,
        productId,
        period.from,
        period.to,
        SALE_TRANSACTION_TYPE,
        asTextArrayLiteral(RECOGNIZED_TRANSACTION_STATUSES),
      ],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      productId: row.product_id,
      name: row.product_name ?? '',
      quantity: row.quantity,
      revenueMinor: row.revenue_minor,
      cogsMinor: row.cogs_minor,
      uncostedLineCount: row.uncosted_line_count,
      lineCount: row.line_count,
    };
  }

  async getRevenueConcentration(
    businessId: BusinessId,
    period: HalfOpenPeriod,
    limit: number,
  ) {
    return this.db.query<RevenueShareRow>(
      REVENUE_CONCENTRATION_SQL,
      [businessId, period.from, period.to, SALE_TRANSACTION_TYPE, asTextArrayLiteral(RECOGNIZED_TRANSACTION_STATUSES), limit],
    );
  }

  async getProductSalesInPeriod(businessId: BusinessId, period: HalfOpenPeriod) {
    const rows = await this.db.query<ProductSalesSqlRow>(
      PRODUCT_SALES_SQL,
      [
        businessId,
        period.from,
        period.to,
        SALE_TRANSACTION_TYPE,
        asTextArrayLiteral(RECOGNIZED_TRANSACTION_STATUSES),
      ],
    );
    return rows.map((row) => ({
      productId: row.product_id,
      name: row.product_name ?? '',
      quantity: row.quantity,
      revenueMinor: row.revenue_minor,
      discountMinor: row.discount_minor,
      cogsMinor: row.cogs_minor,
      uncostedLineCount: row.uncosted_line_count,
      lineCount: row.line_count,
    }));
  }

  async getPurchasePrices(businessId: BusinessId, period: HalfOpenPeriod) {
    const rows = await this.db.query<PurchasePriceRow>(
      PURCHASE_PRICE_SQL,
      [
        businessId,
        period.from,
        period.to,
        PURCHASE_TRANSACTION_TYPE,
        asTextArrayLiteral(RECOGNIZED_TRANSACTION_STATUSES),
      ],
    );
    return rows.map((row) => ({
      productId: row.product_id,
      weightedUnitPriceMinor: row.weighted_unit_price_minor,
      quantity: row.quantity,
      lineCount: row.line_count,
    }));
  }

  async getProductsForAnalysis(businessId: BusinessId) {
    const rows = await this.db.query<ProductAnalysisRow>(PRODUCTS_FOR_ANALYSIS_SQL, [
      businessId,
      MAX_PRODUCT_ROWS,
    ]);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      status: row.status,
      supplierId: row.supplier_id,
      costPriceMinor: row.cost_price_minor,
      sellingPriceMinor: row.selling_price_minor,
      currentStock: row.current_stock,
      reorderPoint: row.reorder_point,
      createdAt: row.created_at,
    }));
  }
}

function toReceivableObligation(row: OpenObligationRow) {
  return {
    id: row.id,
    customerId: row.counterparty_id,
    openMinor: row.open_minor,
    dueDate: row.due_date,
    daysOverdue: row.days_overdue,
  };
}

function toPayableObligation(row: OpenObligationRow) {
  return {
    id: row.id,
    supplierId: row.counterparty_id,
    openMinor: row.open_minor,
    dueDate: row.due_date,
    daysOverdue: row.days_overdue,
  };
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface SaleTotalsRow {
  readonly currency: string;
  readonly gross_revenue_minor?: number;
  readonly discount_minor?: number;
  readonly tax_minor?: number;
  readonly total_invoiced_minor?: number;
  readonly refund_minor?: number;
  readonly sale_count?: number;
  readonly quantity_sold?: number;
  readonly line_count?: number;
  readonly uncosted_line_count?: number;
  readonly cogs_minor?: number;
}

interface ExpenseCategoryRow {
  readonly category: string;
  readonly status: string;
  readonly amount_minor: number;
  readonly entry_count: number;
}

interface InventoryValuationRow {
  readonly value_minor: number;
  readonly product_count: number;
}

interface OpenBalanceRow {
  readonly open_minor: number;
  readonly open_count: number;
  readonly overdue_minor: number;
  readonly record_count: number;
}

interface LedgerCashRow {
  readonly opening_cash_minor: number;
  readonly sales_received_minor: number;
  readonly customer_payments_minor: number;
  readonly purchase_paid_minor: number;
  readonly refunds_paid_minor: number;
  readonly expenses_paid_minor: number;
  readonly recognised_transaction_count: number;
}

interface OpenObligationRow {
  readonly id: string;
  readonly counterparty_id: string;
  readonly counterparty_name?: string | null;
  readonly open_minor: number;
  readonly due_date: Date;
  readonly days_overdue: number;
}

interface RecurringExpenseRow {
  readonly id: string;
  readonly category: string;
  readonly amount_minor: number;
  readonly currency: string;
  readonly recurring_frequency: string | null;
  readonly recurring_next_due_date: Date;
  readonly recurring_end_date: Date | null;
}

interface DatedExpenseRow {
  readonly id: string;
  readonly category: string;
  readonly amount_minor: number;
  readonly expense_date: Date;
}

interface ReportingSettingsRow {
  readonly currency: string;
  readonly timezone: string;
  readonly overdue_threshold_days: number;
}

interface ProductPerformanceSqlRow {
  readonly product_id: string;
  readonly product_name: string | null;
  readonly quantity: number;
  readonly revenue_minor: number;
  readonly cogs_minor: number;
  readonly uncosted_line_count: number;
  readonly line_count: number;
}

interface ProductSalesSqlRow extends ProductPerformanceSqlRow {
  readonly discount_minor: number;
}

interface PurchasePriceRow {
  readonly product_id: string;
  readonly weighted_unit_price_minor: number;
  readonly quantity: number;
  readonly line_count: number;
}

interface ProductAnalysisRow {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly status: string;
  readonly supplier_id: string | null;
  readonly cost_price_minor: number;
  readonly selling_price_minor: number;
  readonly current_stock: number;
  readonly reorder_point: number;
  readonly created_at: Date;
}

// ---------------------------------------------------------------------------
// Statements
//
// Cost of goods is derived per line as
//   round(cost_price_minor * quantity)
// using each product's current cost price, because `transaction_items` carries no
// cost column. A line with no linked product, or with no recorded cost, is
// counted as uncosted so the domain layer can degrade data quality honestly
// rather than treating missing cost as zero.
const SALE_TOTALS_SQL = `
SELECT
  t.currency::text                                                      AS currency,
  COALESCE(SUM(CASE WHEN t.type = $4 THEN t.subtotal_minor END), 0)     AS gross_revenue_minor,
  COALESCE(SUM(CASE WHEN t.type = $4 THEN t.discount_minor END), 0)     AS discount_minor,
  COALESCE(SUM(CASE WHEN t.type = $4 THEN t.tax_minor END), 0)          AS tax_minor,
  COALESCE(SUM(CASE WHEN t.type = $4 THEN t.total_minor END), 0)        AS total_invoiced_minor,
  COALESCE(SUM(CASE WHEN t.type = $5 THEN t.total_minor END), 0)        AS refund_minor,
  COUNT(*) FILTER (WHERE t.type = $4)::int                             AS sale_count,
  COALESCE(SUM(line.quantity), 0)                                      AS quantity_sold,
  COUNT(line.id)::int                                                  AS line_count,
  COUNT(*) FILTER (WHERE line.id IS NOT NULL AND line.product_id IS NULL)::int
                                                                        AS uncosted_line_count,
  COALESCE(SUM(line.cogs_minor), 0)                                    AS cogs_minor
FROM transactions t
LEFT JOIN LATERAL (
  SELECT
    ti.product_id,
    ti.quantity,
    CASE WHEN p.cost_price_minor IS NULL THEN NULL
         ELSE ROUND(p.cost_price_minor * ti.quantity)::bigint
    END AS cogs_minor
  FROM transaction_items ti
  LEFT JOIN products p ON p.id = ti.product_id AND p.business_id = t.business_id
  WHERE ti.transaction_id = t.id
) line ON true
WHERE t.business_id = $1
  AND t.transaction_date >= $2
  AND t.transaction_date <  $3
  AND t.status = ANY($6::text[])
GROUP BY t.currency
ORDER BY t.currency
`;

const OPERATING_EXPENSE_TOTAL_SQL = `
SELECT COALESCE(SUM(e.amount_minor), 0)::bigint AS total_minor
FROM expenses e
WHERE e.business_id = $1
  AND e.expense_date >= $2
  AND e.expense_date <  $3
  AND e.status = ANY($4::text[])
`;

const EXPENSE_BY_CATEGORY_SQL = `
SELECT
  e.category::text   AS category,
  e.status::text     AS status,
  COALESCE(SUM(e.amount_minor), 0)::bigint AS amount_minor,
  COUNT(*)::int      AS entry_count
FROM expenses e
WHERE e.business_id = $1
  AND e.expense_date >= $2
  AND e.expense_date <  $3
  AND e.status = ANY($4::text[])
GROUP BY e.category, e.status
ORDER BY amount_minor DESC, e.category ASC, e.status ASC
`;

const INVENTORY_VALUATION_SQL = `
SELECT
  COALESCE(SUM(ROUND(p.cost_price_minor * p.current_stock)), 0)::bigint AS value_minor,
  COUNT(*)::int AS product_count
FROM products p
WHERE p.business_id = $1
`;

const OPEN_RECEIVABLES_SQL = `
SELECT
  COALESCE(SUM(r.amount_minor - r.paid_amount_minor), 0)::bigint      AS open_minor,
  COUNT(*) FILTER (WHERE r.status = ANY($3::text[]))::int             AS open_count,
  COALESCE(SUM(CASE WHEN r.due_date < $2
                     THEN r.amount_minor - r.paid_amount_minor
                     ELSE 0 END), 0)::bigint                          AS overdue_minor,
  COUNT(*)::int                                                       AS record_count
FROM receivables r
WHERE r.business_id = $1
`;

const OPEN_PAYABLES_SQL = `
SELECT
  COALESCE(SUM(p.amount_minor - p.paid_amount_minor), 0)::bigint AS open_minor,
  COUNT(*) FILTER (WHERE p.status = ANY($3::text[]))::int        AS open_count,
  COALESCE(SUM(CASE WHEN p.due_date < $2
                     THEN p.amount_minor - p.paid_amount_minor
                     ELSE 0 END), 0)::bigint                    AS overdue_minor,
  COUNT(*)::int                                                   AS record_count
FROM payables p
WHERE p.business_id = $1
`;

const LEDGER_CASH_SQL = `
WITH tx AS (
  SELECT t.type::text AS type, t.total_minor
  FROM transactions t
  WHERE t.business_id = $1
    AND t.transaction_date <  $3
    AND t.status = ANY($4::text[])
),
exp AS (
  SELECT COALESCE(SUM(e.amount_minor), 0)::bigint AS expenses_paid_minor
  FROM expenses e
  WHERE e.business_id = $1
    AND e.expense_date <  $3
    AND e.status = ANY($5::text[])
)
SELECT
  COALESCE((
    SELECT SUM(t2.total_minor)
    FROM transactions t2
    WHERE t2.business_id = $1
      AND t2.transaction_date >= $2
      AND t2.transaction_date <  $3
      AND t2.status = ANY($4::text[])
      AND t2.type IN ('sale', 'payment')
  ), 0)::bigint                                        AS opening_cash_minor,
  COALESCE(SUM(CASE WHEN type = 'sale'    THEN total_minor END), 0)::bigint AS sales_received_minor,
  COALESCE(SUM(CASE WHEN type = 'payment' THEN total_minor END), 0)::bigint AS customer_payments_minor,
  COALESCE(SUM(CASE WHEN type = 'purchase' THEN total_minor END), 0)::bigint AS purchase_paid_minor,
  COALESCE(SUM(CASE WHEN type = 'refund'   THEN total_minor END), 0)::bigint AS refunds_paid_minor,
  (SELECT expenses_paid_minor FROM exp)                AS expenses_paid_minor,
  COUNT(*)::int                                        AS recognised_transaction_count
FROM tx
`;

/**
 * Open receivables already past the business's configured overdue threshold.
 * The threshold is a bound parameter so a merchant's own setting, not a constant
 * baked into this file, decides what counts as overdue.
 */
const OVERDUE_RECEIVABLES_SQL = `
SELECT
  r.id::text                                                        AS id,
  r.customer_id::text                                               AS counterparty_id,
  COALESCE(c.name, 'Unknown')::text                                 AS counterparty_name,
  (r.amount_minor - r.paid_amount_minor)::bigint                   AS open_minor,
  r.due_date                                                        AS due_date,
  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz - r.due_date)) / 86400))::int
                                                                    AS days_overdue
FROM receivables r
LEFT JOIN customers c ON c.id = r.customer_id AND c.business_id = r.business_id
WHERE r.business_id = $1
  AND r.status = ANY($3::text[])
  AND r.amount_minor > r.paid_amount_minor
  AND r.due_date <= $2::timestamptz - (GREATEST($4::int, 0) * INTERVAL '1 day')
ORDER BY r.due_date ASC, r.id ASC
LIMIT $5
`;

const OPEN_RECEIVABLE_OBLIGATIONS_SQL = `
SELECT
  r.id::text                                                        AS id,
  r.customer_id::text                                               AS counterparty_id,
  (r.amount_minor - r.paid_amount_minor)::bigint                   AS open_minor,
  r.due_date                                                        AS due_date,
  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz - r.due_date)) / 86400))::int
                                                                    AS days_overdue
FROM receivables r
WHERE r.business_id = $1
  AND r.status = ANY($3::text[])
  AND r.amount_minor > r.paid_amount_minor
ORDER BY r.due_date ASC, r.id ASC
LIMIT $4
`;

const OPEN_PAYABLE_OBLIGATIONS_SQL = `
SELECT
  p.id::text                                                        AS id,
  p.supplier_id::text                                               AS counterparty_id,
  (p.amount_minor - p.paid_amount_minor)::bigint                   AS open_minor,
  p.due_date                                                        AS due_date,
  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz - p.due_date)) / 86400))::int
                                                                    AS days_overdue
FROM payables p
WHERE p.business_id = $1
  AND p.status = ANY($3::text[])
  AND p.amount_minor > p.paid_amount_minor
ORDER BY p.due_date ASC, p.id ASC
LIMIT $4
`;

const RECURRING_EXPENSES_SQL = `
SELECT
  e.id::text                AS id,
  e.category::text          AS category,
  e.amount_minor::bigint    AS amount_minor,
  e.currency::text          AS currency,
  e.recurring_frequency::text AS recurring_frequency,
  e.recurring_next_due_date AS recurring_next_due_date,
  e.recurring_end_date      AS recurring_end_date
FROM expenses e
WHERE e.business_id = $1
  AND e.is_recurring
  AND e.recurring_next_due_date IS NOT NULL
  AND e.status = ANY($2::text[])
ORDER BY e.recurring_next_due_date ASC, e.id ASC
LIMIT $3
`;

const DATED_EXPENSES_SQL = `
SELECT
  e.id::text             AS id,
  e.category::text       AS category,
  e.amount_minor::bigint AS amount_minor,
  e.expense_date         AS expense_date
FROM expenses e
WHERE e.business_id = $1
  AND NOT e.is_recurring
  AND e.expense_date >= $2
  AND e.expense_date <  $3
  AND e.status = ANY($4::text[])
ORDER BY e.expense_date ASC, e.id ASC
LIMIT $5
`;

const REPORTING_SETTINGS_SQL = `
SELECT
  b.currency::text                 AS currency,
  b.timezone::text                 AS timezone,
  b.overdue_threshold_days::int    AS overdue_threshold_days
FROM businesses b
WHERE b.id = $1
LIMIT 1
`;

/**
 * Per-product revenue and derived cost over the period. Uses the same cost
 * basis as `SALE_TOTALS_SQL` so product figures always reconcile with the
 * snapshot they are compared against.
 */
const PRODUCT_PERFORMANCE_SQL = `
SELECT
  ti.product_id::text                                                AS product_id,
  MIN(p.name)::text                                                  AS product_name,
  COALESCE(SUM(ti.quantity), 0)                                      AS quantity,
  COALESCE(SUM(ti.unit_price_minor * ti.quantity - ti.discount_minor), 0)::bigint
                                                                     AS revenue_minor,
  COALESCE(SUM(CASE WHEN p.cost_price_minor IS NULL THEN 0
                    ELSE ROUND(p.cost_price_minor * ti.quantity) END), 0)::bigint
                                                                     AS cogs_minor,
  COUNT(*) FILTER (WHERE p.cost_price_minor IS NULL)::int            AS uncosted_line_count,
  COUNT(*)::int                                                      AS line_count
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
LEFT JOIN products p ON p.id = ti.product_id AND p.business_id = t.business_id
WHERE t.business_id = $1
  AND ti.product_id = $2
  AND t.type = $5
  AND t.status = ANY($6::text[])
  AND t.transaction_date >= $3
  AND t.transaction_date <  $4
GROUP BY ti.product_id
`;

const PRODUCT_SALES_SQL = `
SELECT
  ti.product_id::text                                                AS product_id,
  MIN(p.name)::text                                                  AS product_name,
  COALESCE(SUM(ti.quantity), 0)                                      AS quantity,
  COALESCE(SUM(ti.unit_price_minor * ti.quantity - ti.discount_minor), 0)::bigint
                                                                     AS revenue_minor,
  COALESCE(SUM(ti.discount_minor), 0)::bigint                        AS discount_minor,
  COALESCE(SUM(CASE WHEN p.cost_price_minor IS NULL THEN 0
                    ELSE ROUND(p.cost_price_minor * ti.quantity) END), 0)::bigint
                                                                     AS cogs_minor,
  COUNT(*) FILTER (WHERE p.cost_price_minor IS NULL)::int            AS uncosted_line_count,
  COUNT(*)::int                                                      AS line_count
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
LEFT JOIN products p ON p.id = ti.product_id AND p.business_id = t.business_id
WHERE t.business_id = $1
  AND t.type = $4
  AND t.status = ANY($5::text[])
  AND t.transaction_date >= $2
  AND t.transaction_date <  $3
  AND ti.product_id IS NOT NULL
GROUP BY ti.product_id
`;

/**
 * Revenue by counterparty, bounded by `limit`. The cap is a bound parameter and
 * also enforced by `revenue_concentration_limit` below, so a caller cannot turn
 * this into an unbounded aggregation.
 */
const REVENUE_CONCENTRATION_SQL = `
SELECT
  t.counterparty_id::text                                          AS counterparty_id,
  t.counterparty_type::text                                        AS counterparty_type,
  COALESCE(SUM(t.subtotal_minor - t.discount_minor), 0)::bigint   AS revenue_minor,
  COUNT(*)::int                                                    AS transaction_count
FROM transactions t
WHERE t.business_id = $1
  AND t.type = $4
  AND t.status = ANY($5::text[])
  AND t.transaction_date >= $2
  AND t.transaction_date <  $3
GROUP BY t.counterparty_id, t.counterparty_type
ORDER BY revenue_minor DESC, t.counterparty_id ASC
LIMIT LEAST(GREATEST($6::int, 1), 500)
`;

const PURCHASE_PRICE_SQL = `
SELECT
  ti.product_id::text                                                             AS product_id,
  ROUND(SUM(ti.unit_price_minor * ti.quantity) / NULLIF(SUM(ti.quantity), 0))::bigint
                                                                                  AS weighted_unit_price_minor,
  COALESCE(SUM(ti.quantity), 0)                                                   AS quantity,
  COUNT(*)::int                                                                   AS line_count
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
WHERE t.business_id = $1
  AND t.type = $4
  AND t.status = ANY($5::text[])
  AND t.transaction_date >= $2
  AND t.transaction_date <  $3
  AND ti.product_id IS NOT NULL
GROUP BY ti.product_id
HAVING SUM(ti.quantity) > 0
`;

const PRODUCTS_FOR_ANALYSIS_SQL = `
SELECT
  p.id::text             AS id,
  p.name::text           AS name,
  p.category::text       AS category,
  p.status::text         AS status,
  p.supplier_id::text    AS supplier_id,
  p.cost_price_minor::bigint    AS cost_price_minor,
  p.selling_price_minor::bigint AS selling_price_minor,
  p.current_stock                 AS current_stock,
  p.reorder_point                 AS reorder_point,
  p.created_at                    AS created_at
FROM products p
WHERE p.business_id = $1
ORDER BY p.id ASC
LIMIT $2
`;
/** Upper bound on obligations returned by one projection read. */
export const MAX_OBLIGATION_ROWS = 500;

/** Upper bound on products returned by one stock or margin analysis read. */
export const MAX_PRODUCT_ROWS = 1_000;

/** Upper bound on recurring expenses expanded by one projection read. */
export const MAX_RECURRING_ROWS = 200;

/** Upper bound on dated expenses read for one horizon. */
export const MAX_DATED_EXPENSE_ROWS = 1_000;

/**
 * Exported for the SQL-safety test suite: proves that the text-array bind
 * formatter refuses its values rather than escaping them.
 */
export const __testing = { asTextArrayLiteral };
