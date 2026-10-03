// Merchant Brain: inventory facts
//
// Stock lives on `products.current_stock`; there is no separate stock table.
// `inventory_movements` is the append-only ledger behind it. Reorder and
// valuation decisions are made by the deterministic rules in
// `modules/inventory/domain/rules.ts`, not here and not in SQL, so the same
// answer is produced whether a tool, a route, or a test asks.

import 'server-only';

import type { BusinessId, CurrencyCode } from '@/lib/types';
import { calculateInventoryValue, needsReorder } from '@/modules/inventory';
import type { Product } from '@/modules/inventory';
import { asProductId } from '@/lib/types';
import type { DatabaseClient } from '@/lib/database/client';
import { tenantQuery } from './tenant-query';

export interface StockRow {
  readonly id: string;
  readonly name: string;
  readonly sku: string | null;
  readonly category: string | null;
  readonly unit: string;
  readonly cost_price_minor: number;
  readonly selling_price_minor: number;
  readonly currency: string;
  readonly current_stock: number;
  readonly reorder_point: number;
  readonly reorder_quantity: number;
  readonly status: string;
}

const STOCK_SQL = `
SELECT
  id, name, sku, category, unit,
  cost_price_minor, selling_price_minor, currency,
  current_stock, reorder_point, reorder_quantity, status
FROM products
WHERE business_id = $1
  AND status <> 'discontinued'
  AND ($2::text[] IS NULL OR category = ANY($2::text[]))
ORDER BY name
LIMIT $3
`.trim();

export interface InventorySnapshot {
  readonly productCount: number;
  readonly lowStockCount: number;
  /** Deterministic: `calculateInventoryValue` over cost price. */
  readonly inventoryValueMinor: number;
  readonly currency: CurrencyCode;
  readonly lowStock: readonly LowStockItem[];
  readonly truncated: boolean;
}

export interface LowStockItem {
  readonly productId: string;
  readonly name: string;
  readonly sku: string | null;
  readonly currentStock: number;
  readonly reorderPoint: number;
  readonly reorderQuantity: number;
  readonly unit: string;
}

/**
 * Loads stock and derives reorder state.
 *
 * `needsReorder` is called with a `Product` assembled from the row, so the tool
 * inherits the domain rule verbatim. Valuation is likewise delegated rather
 * than reimplemented as a SQL `SUM`.
 */
export async function loadInventorySnapshot(
  database: DatabaseClient,
  businessId: BusinessId,
  options: { readonly categories?: readonly string[]; readonly limit: number },
): Promise<InventorySnapshot> {
  const rows = await tenantQuery<StockRow>(database, businessId, STOCK_SQL, [
    options.categories ? [...options.categories] : null,
    options.limit,
  ]);

  const lowStock: LowStockItem[] = [];
  for (const row of rows) {
    const product = toProduct(row, businessId);
    if (!needsReorder(product)) continue;
    lowStock.push({
      productId: row.id,
      name: row.name,
      sku: row.sku,
      currentStock: row.current_stock,
      reorderPoint: row.reorder_point,
      reorderQuantity: row.reorder_quantity,
      unit: row.unit,
    });
  }

  return {
    productCount: rows.length,
    lowStockCount: lowStock.length,
    inventoryValueMinor: calculateInventoryValue(rows.map((row) => ({ currentStock: row.current_stock, costPrice: { amount: row.cost_price_minor, currency: row.currency as CurrencyCode } }))),
    currency: (rows[0]?.currency ?? 'INR') as CurrencyCode,
    lowStock,
    truncated: rows.length === options.limit,
  };
}

export interface MovementRow {
  readonly id: string;
  readonly product_id: string;
  readonly product_name: string;
  readonly type: string;
  readonly quantity: number;
  readonly previous_stock: number;
  readonly new_stock: number;
  readonly reference: string | null;
  readonly created_at: Date | string;
}

const MOVEMENTS_SQL = `
SELECT
  m.id, m.product_id, p.name AS product_name, m.type,
  m.quantity, m.previous_stock, m.new_stock, m.reference, m.created_at
FROM inventory_movements m
JOIN products p
  ON p.id = m.product_id
 AND p.business_id = $1
WHERE m.business_id = $1
  AND m.created_at >= $2::timestamptz
  AND m.created_at < $3::timestamptz
  AND ($4::text IS NULL OR m.type = $4)
ORDER BY m.created_at DESC
LIMIT $5
`.trim();

export async function loadInventoryMovements(
  database: DatabaseClient,
  businessId: BusinessId,
  options: {
    readonly from: Date;
    readonly to: Date;
    readonly type?: string;
    readonly limit: number;
  },
): Promise<readonly MovementRow[]> {
  return tenantQuery<MovementRow>(database, businessId, MOVEMENTS_SQL, [
    options.from.toISOString(),
    options.to.toISOString(),
    options.type ?? null,
    options.limit,
  ]);
}

/** Assembles the domain `Product` the reorder rule expects. */
function toProduct(row: StockRow, businessId: BusinessId): Product {
  const now = new Date(0);
  return {
    id: asProductId(row.id),
    businessId,
    name: row.name,
    unit: row.unit as Product['unit'],
    costPrice: { amount: row.cost_price_minor, currency: row.currency as CurrencyCode },
    sellingPrice: { amount: row.selling_price_minor, currency: row.currency as CurrencyCode },
    currentStock: row.current_stock,
    reorderPoint: row.reorder_point,
    reorderQuantity: row.reorder_quantity,
    status: row.status as Product['status'],
    createdAt: now,
    updatedAt: now,
  } as Product;
}
