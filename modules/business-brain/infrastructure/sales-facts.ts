// Merchant Brain: sales and transaction facts
//
// All aggregation happens in Postgres over integer `bigint` minor units, and
// the arithmetic that derives a ratio (margin, change) happens in the
// deterministic domain layer, never in SQL string interpolation and never in
// the model.
//
// A note on `voided`: voided and draft transactions are excluded everywhere.
// Counting them would overstate revenue.
//
// A note on currency: no FX conversion exists anywhere in this codebase, so
// every aggregate is grouped by currency. A tenant holding two currencies gets
// two honest rows rather than one meaningless sum.

import 'server-only';

import type { BusinessId, CurrencyCode } from '@/lib/types';
import type { DatabaseClient } from '@/lib/database/client';
import { tenantQuery } from './tenant-query';

/** Transaction states that represent settled business activity. */
const SETTLED = "('confirmed','completed')";

export interface PeriodSalesTotals {
  readonly currency: CurrencyCode;
  readonly revenueMinor: number;
  readonly refundMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly transactionCount: number;
}

interface TotalsRow {
  readonly currency: string;
  readonly revenue_minor: number;
  readonly refund_minor: number;
  readonly discount_minor: number;
  readonly tax_minor: number;
  readonly transaction_count: number;
}

const SALES_TOTALS_SQL = `
SELECT
  currency,
  COALESCE(SUM(CASE WHEN type = 'sale'    THEN total_minor END), 0) AS revenue_minor,
  COALESCE(SUM(CASE WHEN type = 'refund'  THEN total_minor END), 0) AS refund_minor,
  COALESCE(SUM(CASE WHEN type = 'sale'    THEN discount_minor END), 0) AS discount_minor,
  COALESCE(SUM(CASE WHEN type = 'sale'    THEN tax_minor END), 0) AS tax_minor,
  COUNT(*) FILTER (WHERE type = 'sale') AS transaction_count
FROM transactions
WHERE business_id = $1
  AND status IN ${SETTLED}
  AND transaction_date >= $2::timestamptz
  AND transaction_date < $3::timestamptz
  AND type IN ('sale', 'refund')
GROUP BY currency
ORDER BY currency
`.trim();

export async function loadSalesTotals(
  database: DatabaseClient,
  businessId: BusinessId,
  from: Date,
  to: Date,
): Promise<readonly PeriodSalesTotals[]> {
  const rows = await tenantQuery<TotalsRow>(database, businessId, SALES_TOTALS_SQL, [
    from.toISOString(),
    to.toISOString(),
  ]);

  return rows.map((row) => ({
    currency: row.currency as CurrencyCode,
    revenueMinor: row.revenue_minor,
    refundMinor: row.refund_minor,
    discountMinor: row.discount_minor,
    taxMinor: row.tax_minor,
    transactionCount: row.transaction_count,
  }));
}

// ---------------------------------------------------------------------------
// Product performance
// ---------------------------------------------------------------------------

export interface ProductPerformanceRow {
  readonly productId: string;
  readonly productName: string;
  readonly category: string | null;
  readonly unitsSold: number;
  readonly revenueMinor: number;
  readonly costMinor: number;
  readonly currency: CurrencyCode;
}

interface ProductRow {
  readonly product_id: string;
  readonly product_name: string;
  readonly category: string | null;
  readonly units_sold: number;
  readonly revenue_minor: number;
  readonly cost_minor: number;
  readonly currency: string;
}

/**
 * Revenue and cost of goods per product.
 *
 * COGS is derived from `products.cost_price_minor` rather than from the price
 * actually charged, so gross profit reflects the margin the merchant earned
 * rather than the margin they intended. The join goes through
 * `transaction_items` -> `transactions` because `transaction_items` carries no
 * `business_id` of its own; the tenant predicate sits on `transactions`.
 */
const PRODUCT_PERFORMANCE_SQL = `
SELECT
  ti.product_id,
  ti.product_name,
  p.category,
  COALESCE(SUM(ti.quantity), 0) AS units_sold,
  COALESCE(SUM(ti.total_minor), 0) AS revenue_minor,
  COALESCE(SUM((ti.quantity * p.cost_price_minor)::bigint), 0) AS cost_minor,
  t.currency
FROM transaction_items ti
JOIN transactions t
  ON t.id = ti.transaction_id
 AND t.business_id = $1
LEFT JOIN products p
  ON p.id = ti.product_id
 AND p.business_id = $1
WHERE t.status IN ${SETTLED}
  AND t.type = 'sale'
  AND t.transaction_date >= $2::timestamptz
  AND t.transaction_date < $3::timestamptz
  AND ti.product_id IS NOT NULL
  AND ($4::text[] IS NULL OR p.category = ANY($4::text[]))
GROUP BY ti.product_id, ti.product_name, p.category, t.currency
ORDER BY revenue_minor DESC
LIMIT $5
`.trim();

export async function loadProductPerformance(
  database: DatabaseClient,
  businessId: BusinessId,
  options: {
    readonly from: Date;
    readonly to: Date;
    readonly categories?: readonly string[];
    readonly limit: number;
  },
): Promise<readonly ProductPerformanceRow[]> {
  const rows = await tenantQuery<ProductRow>(database, businessId, PRODUCT_PERFORMANCE_SQL, [
    options.from.toISOString(),
    options.to.toISOString(),
    options.categories ? [...options.categories] : null,
    options.limit,
  ]);

  return rows.map((row) => ({
    productId: row.product_id,
    productName: row.product_name,
    category: row.category,
    unitsSold: row.units_sold,
    revenueMinor: row.revenue_minor,
    costMinor: row.cost_minor,
    currency: row.currency as CurrencyCode,
  }));
}

// ---------------------------------------------------------------------------
// Transaction search
// ---------------------------------------------------------------------------

export interface TransactionSearchFilters {
  readonly from: Date;
  readonly to: Date;
  readonly type?: 'sale' | 'purchase' | 'payment' | 'refund';
  readonly counterpartyId?: string;
  readonly minTotalMinor?: number;
  readonly limit: number;
}

export interface TransactionSearchHit {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly counterpartyType: string;
  readonly counterpartyId: string;
  readonly totalMinor: number;
  readonly currency: CurrencyCode;
  readonly transactionDate: string;
  readonly reference: string | null;
}

interface SearchRow {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly counterparty_type: string;
  readonly counterparty_id: string;
  readonly total_minor: number;
  readonly currency: string;
  readonly transaction_date: Date | string;
  readonly reference: string | null;
}

/**
 * Bounded structured search over the transaction ledger.
 *
 * The filter set is a fixed allowlist of named columns compared to bound
 * parameters. There is no free-form filter expression, no `ORDER BY` supplied
 * by the caller, and no way to reach a column that is not listed here — which
 * is why `notes` and `counterparty_id` are not searchable and why the statement
 * cannot be parameterised into injection.
 *
 * `ORDER BY transaction_date DESC, id DESC LIMIT $n` is fixed. `LIMIT` is a
 * bound parameter that the tool schema has already capped, so the query cannot
 * become an unbounded scan.
 */
const TRANSACTION_SEARCH_SQL = `
SELECT
  id, type, status, counterparty_type, counterparty_id,
  total_minor, currency, transaction_date, reference
FROM transactions
WHERE business_id = $1
  AND transaction_date >= $2::timestamptz
  AND transaction_date < $3::timestamptz
  AND status IN ${SETTLED}
  AND ($4::text IS NULL OR type = $4)
  AND ($5::text IS NULL OR counterparty_id = $5)
  AND ($6::bigint IS NULL OR total_minor >= $6)
ORDER BY transaction_date DESC, id DESC
LIMIT $7
`.trim();

export async function searchTransactions(
  database: DatabaseClient,
  businessId: BusinessId,
  filters: TransactionSearchFilters,
): Promise<readonly TransactionSearchHit[]> {
  const rows = await tenantQuery<SearchRow>(database, businessId, TRANSACTION_SEARCH_SQL, [
    filters.from.toISOString(),
    filters.to.toISOString(),
    filters.type ?? null,
    filters.counterpartyId ?? null,
    filters.minTotalMinor ?? null,
    filters.limit,
  ]);

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    counterpartyType: row.counterparty_type,
    counterpartyId: row.counterparty_id,
    totalMinor: row.total_minor,
    currency: row.currency as CurrencyCode,
    transactionDate:
      row.transaction_date instanceof Date
        ? row.transaction_date.toISOString()
        : new Date(row.transaction_date).toISOString(),
    reference: row.reference,
  }));
}
