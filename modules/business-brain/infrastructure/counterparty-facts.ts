// Merchant Brain: customer and supplier facts
//
// PII MINIMISATION
// ----------------
// `customers` and `suppliers` carry phone, email, address and GSTIN. None of
// those columns appear in any statement here, and none appears in any tool
// output. A merchant asking "why did sales drop" needs balances, activity and
// names — not contact details — so the contact fields stay in the database.
//
// Names are included because they carry the business meaning: "why did Sudhir
// Sharma stop buying" is unanswerable otherwise, and a customer name inside the
// tenant's own boundary is not a disclosure to a third party.
//
// Every statement is tenant-scoped. `receivables` and `payables` are queried
// directly (they carry `business_id`) rather than joined through a parent.

import 'server-only';

import type { BusinessId, CurrencyCode } from '@/lib/types';
import type { DatabaseClient } from '@/lib/database/client';
import { tenantQuery } from './tenant-query';

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface CustomerActivityRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly currency: string;
  readonly total_purchases_minor: number;
  readonly outstanding_balance_minor: number;
  readonly last_transaction_date: Date | string | null;
  readonly purchase_count: number;
  readonly recent_purchase_minor: number;
}

const CUSTOMER_ACTIVITY_SQL = `
SELECT
  c.id,
  c.name,
  c.status,
  c.currency,
  c.total_purchases_minor,
  c.outstanding_balance_minor,
  c.last_transaction_date,
  COUNT(t.id) AS purchase_count,
  COALESCE(SUM(t.total_minor), 0) AS recent_purchase_minor
FROM customers c
LEFT JOIN transactions t
  ON t.business_id = $1
 AND t.counterparty_type = 'customer'
 AND t.counterparty_id = c.id
 AND t.type = 'sale'
 AND t.status IN ('confirmed', 'completed')
 AND t.transaction_date >= $2::timestamptz
 AND t.transaction_date < $3::timestamptz
WHERE c.business_id = $1
  AND ($4::text IS NULL OR c.id::text = $4)
GROUP BY c.id, c.name, c.status, c.currency,
         c.total_purchases_minor, c.outstanding_balance_minor, c.last_transaction_date
ORDER BY recent_purchase_minor DESC, c.name
LIMIT $5
`.trim();

export async function loadCustomerActivity(
  database: DatabaseClient,
  businessId: BusinessId,
  options: {
    readonly from: Date;
    readonly to: Date;
    readonly customerId?: string;
    readonly limit: number;
  },
): Promise<readonly CustomerActivityRow[]> {
  return tenantQuery<CustomerActivityRow>(database, businessId, CUSTOMER_ACTIVITY_SQL, [
    options.from.toISOString(),
    options.to.toISOString(),
    options.customerId ?? null,
    options.limit,
  ]);
}

export interface ReceivablesSummary {
  readonly currency: CurrencyCode;
  readonly outstandingMinor: number;
  readonly overdueMinor: number;
  readonly overdueCount: number;
}

interface ReceivableRow {
  readonly currency: string;
  readonly outstanding_minor: number;
  readonly overdue_minor: number;
  readonly overdue_count: number;
}

const RECEIVABLES_SQL = `
SELECT
  currency,
  COALESCE(SUM(amount_minor - paid_amount_minor), 0) AS outstanding_minor,
  COALESCE(SUM(amount_minor - paid_amount_minor) FILTER (WHERE status = 'overdue'), 0) AS overdue_minor,
  COUNT(*) FILTER (WHERE status = 'overdue') AS overdue_count
FROM receivables
WHERE business_id = $1
  AND status IN ('pending', 'partial', 'overdue')
GROUP BY currency
ORDER BY currency
`.trim();

export async function loadReceivablesSummary(
  database: DatabaseClient,
  businessId: BusinessId,
): Promise<readonly ReceivablesSummary[]> {
  const rows = await tenantQuery<ReceivableRow>(database, businessId, RECEIVABLES_SQL);
  return rows.map((row) => ({
    currency: row.currency as CurrencyCode,
    outstandingMinor: row.outstanding_minor,
    overdueMinor: row.overdue_minor,
    overdueCount: row.overdue_count,
  }));
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export interface SupplierActivityRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly currency: string;
  readonly total_purchases_minor: number;
  readonly outstanding_payable_minor: number;
  readonly last_transaction_date: Date | string | null;
  readonly recent_purchase_minor: number;
  readonly purchase_count: number;
}

const SUPPLIER_ACTIVITY_SQL = `
SELECT
  s.id,
  s.name,
  s.status,
  s.currency,
  s.total_purchases_minor,
  s.outstanding_payable_minor,
  s.last_transaction_date,
  COUNT(t.id) AS purchase_count,
  COALESCE(SUM(t.total_minor), 0) AS recent_purchase_minor
FROM suppliers s
LEFT JOIN transactions t
  ON t.business_id = $1
 AND t.counterparty_type = 'supplier'
 AND t.counterparty_id = s.id
 AND t.type = 'purchase'
 AND t.status IN ('confirmed', 'completed')
 AND t.transaction_date >= $2::timestamptz
 AND t.transaction_date < $3::timestamptz
WHERE s.business_id = $1
  AND ($4::text IS NULL OR s.id::text = $4)
GROUP BY s.id, s.name, s.status, s.currency,
         s.total_purchases_minor, s.outstanding_payable_minor, s.last_transaction_date
ORDER BY recent_purchase_minor DESC, s.name
LIMIT $5
`.trim();

export async function loadSupplierActivity(
  database: DatabaseClient,
  businessId: BusinessId,
  options: {
    readonly from: Date;
    readonly to: Date;
    readonly supplierId?: string;
    readonly limit: number;
  },
): Promise<readonly SupplierActivityRow[]> {
  return tenantQuery<SupplierActivityRow>(database, businessId, SUPPLIER_ACTIVITY_SQL, [
    options.from.toISOString(),
    options.to.toISOString(),
    options.supplierId ?? null,
    options.limit,
  ]);
}

export interface SupplierPricePoint {
  readonly supplierName: string;
  readonly productName: string;
  readonly unitPriceMinor: number;
  readonly currency: CurrencyCode;
  readonly lastUpdated: string;
}

const SUPPLIER_PRICING_SQL = `
SELECT
  s.name AS supplier_name,
  p.name AS product_name,
  sp.unit_price_minor,
  sp.currency,
  sp.last_updated
FROM supplier_pricing sp
JOIN suppliers s
  ON s.id = sp.supplier_id
 AND s.business_id = $1
JOIN products p
  ON p.id = sp.product_id
 AND p.business_id = $1
WHERE sp.business_id = $1
  AND ($2::text IS NULL OR s.id::text = $2)
ORDER BY sp.last_updated DESC
LIMIT $3
`.trim();

/**
 * Current supplier list prices.
 *
 * `supplier_pricing` is keyed UNIQUE on (business, supplier, product), so each
 * row is already the latest price. A price *history* is not derivable from this
 * schema — there is no pricing history table — so the tool reports the current
 * price and says so rather than implying a trend it cannot support.
 */
export async function loadSupplierPricing(
  database: DatabaseClient,
  businessId: BusinessId,
  options: { readonly supplierId?: string; readonly limit: number },
): Promise<readonly SupplierPricePoint[]> {
  const rows = await tenantQuery<{
    supplier_name: string;
    product_name: string;
    unit_price_minor: number;
    currency: string;
    last_updated: Date | string;
  }>(database, businessId, SUPPLIER_PRICING_SQL, [
    options.supplierId ?? null,
    options.limit,
  ]);

  return rows.map((row) => ({
    supplierName: row.supplier_name,
    productName: row.product_name,
    unitPriceMinor: row.unit_price_minor,
    currency: row.currency as CurrencyCode,
    lastUpdated:
      row.last_updated instanceof Date
        ? row.last_updated.toISOString()
        : new Date(row.last_updated).toISOString(),
  }));
}

export interface PayablesSummary {
  readonly currency: CurrencyCode;
  readonly outstandingMinor: number;
  readonly overdueMinor: number;
  readonly overdueCount: number;
}

const PAYABLES_SQL = `
SELECT
  currency,
  COALESCE(SUM(amount_minor - paid_amount_minor), 0) AS outstanding_minor,
  COALESCE(SUM(amount_minor - paid_amount_minor) FILTER (WHERE status = 'overdue'), 0) AS overdue_minor,
  COUNT(*) FILTER (WHERE status = 'overdue') AS overdue_count
FROM payables
WHERE business_id = $1
  AND status IN ('pending', 'partial', 'overdue')
GROUP BY currency
ORDER BY currency
`.trim();

export async function loadPayablesSummary(
  database: DatabaseClient,
  businessId: BusinessId,
): Promise<readonly PayablesSummary[]> {
  const rows = await tenantQuery<ReceivableRow>(database, businessId, PAYABLES_SQL);
  return rows.map((row) => ({
    currency: row.currency as CurrencyCode,
    outstandingMinor: row.outstanding_minor,
    overdueMinor: row.overdue_minor,
    overdueCount: row.overdue_count,
  }));
}
