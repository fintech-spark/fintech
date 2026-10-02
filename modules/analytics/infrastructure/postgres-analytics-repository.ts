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
import {
  asTextArrayLiteral,
  DATED_EXPENSES_SQL,
  EXPENSE_BY_CATEGORY_SQL,
  INVENTORY_VALUATION_SQL,
  LEDGER_CASH_SQL,
  MAX_DATED_EXPENSE_ROWS,
  MAX_OBLIGATION_ROWS,
  MAX_PRODUCT_ROWS,
  MAX_RECURRING_ROWS,
  OPEN_PAYABLES_SQL,
  OPEN_RECEIVABLES_SQL,
  OPEN_RECEIVABLE_OBLIGATIONS_SQL,
  OPEN_PAYABLE_OBLIGATIONS_SQL,
  OPERATING_EXPENSE_TOTAL_SQL,
  OVERDUE_RECEIVABLES_SQL,
  PRODUCT_PERFORMANCE_SQL,
  PRODUCT_SALES_SQL,
  PRODUCTS_FOR_ANALYSIS_SQL,
  PURCHASE_PRICE_SQL,
  RECURRING_EXPENSES_SQL,
  REPORTING_SETTINGS_SQL,
  REVENUE_CONCENTRATION_SQL,
  SALE_TOTALS_SQL,
} from './analytics-sql';

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

export { MAX_DATED_EXPENSE_ROWS, MAX_OBLIGATION_ROWS, MAX_PRODUCT_ROWS, MAX_RECURRING_ROWS };

/**
 * Re-exported so the SQL-safety suite can verify the bind formatter alongside the
 * statements it feeds.
 */
export const __testing = { asTextArrayLiteral };
