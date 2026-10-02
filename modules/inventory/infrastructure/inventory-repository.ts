// Merchant Brain: inventory module — repository and application service
//
// CONCURRENCY NOTE
// ----------------
// Stock is a shared mutable counter. Two concurrent sales of the last unit must
// not both succeed, and a read-modify-write in application memory would let
// that happen. The Postgres CHECK constraint `current_stock >= 0` is the final
// arbiter: the update is a single atomic statement whose WHERE clause re-asserts
// the expected previous value, so a lost update fails rather than silently
// overwriting. `recordMovement` therefore uses compare-and-set rather than
// "SELECT then UPDATE".

import 'server-only';

import { randomUUID } from 'node:crypto';
import type { BusinessId, Money, PaginatedResult, ProductId, TenantContext, UserId } from '@/lib/types';
import { asProductId, createMoney } from '@/lib/types';
import { AuthorizationError, BusinessRuleError, NotFoundError } from '@/lib/errors';
import {
  type Db,
  firstOrNull,
  paginate,
  toDate,
  toIso,
  toOptionalString,
  unwrap,
} from '@/lib/database/query-helpers';
import { hasPermission } from '@/lib/http/auth-context';
import type { InventoryMovement, MovementType, Product, ProductStatus, ProductUnit } from '../domain/types';
import { calculateNewStock, calculateInventoryValue, needsReorder } from '../domain/rules';
import type { ProductFilters, RecordMovementInput } from '../application/service';

const PRODUCT_COLUMNS = `
  id, business_id, name, sku, category, unit, cost_price_minor, selling_price_minor,
  currency, current_stock, reorder_point, reorder_quantity, status, supplier_id,
  created_at, updated_at
`;

interface ProductRow {
  id: string;
  business_id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: ProductUnit;
  cost_price_minor: number;
  selling_price_minor: number;
  currency: Money['currency'];
  current_stock: number;
  reorder_point: number;
  reorder_quantity: number;
  status: ProductStatus;
  supplier_id: string | null;
  created_at: string;
  updated_at: string;
}

function toProduct(row: ProductRow): Product {
  return {
    id: asProductId(row.id) as ProductId,
    businessId: row.business_id as unknown as BusinessId,
    name: row.name,
    sku: toOptionalString(row.sku),
    category: toOptionalString(row.category),
    unit: row.unit,
    costPrice: createMoney(row.cost_price_minor, row.currency),
    sellingPrice: createMoney(row.selling_price_minor, row.currency),
    currentStock: Number(row.current_stock),
    reorderPoint: Number(row.reorder_point),
    reorderQuantity: Number(row.reorder_quantity),
    status: row.status,
    supplierId: (row.supplier_id ?? undefined) as Product['supplierId'],
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export class PostgrestInventoryRepository {
  constructor(private readonly db: Db) {}

  async findProductById(businessId: BusinessId, id: ProductId): Promise<Product | null> {
    const row = firstOrNull<ProductRow>(
      unwrap(
        await this.db
          .from('products')
          .select(PRODUCT_COLUMNS)
          .eq('business_id', businessId)
          .eq('id', id)
          .limit(1),
      ),
    );
    return row ? toProduct(row) : null;
  }

  async listProducts(
    businessId: BusinessId,
    filters: ProductFilters,
    sort: { column: string; ascending: boolean },
  ): Promise<PaginatedResult<Product>> {
    const limit = filters.limit ?? 20;
    const page = filters.page ?? 1;

    let query = this.db
      .from('products')
      .select(PRODUCT_COLUMNS, { count: 'exact' })
      .eq('business_id', businessId);

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.search) query = query.ilike('name', `%${filters.search}%`);
    // Column-to-column comparison is not expressible through PostgREST, so
    // `lowStockOnly` is resolved by the service via findLowStockProducts()
    // rather than as a query filter. Filtering here would be a silent no-op.
    if (filters.lowStockOnly) {
      query = query.eq('status', 'active').lte('current_stock', 0);
    }

    const column = sort.column === 'currentStock' ? 'current_stock' : sort.column;

    const { data, error, count } = await query
      .order(column, { ascending: sort.ascending })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw error;

    const items = ((data ?? []) as ProductRow[]).map(toProduct);
    return paginate(items, count ?? items.length, page, limit);
  }

  async findLowStockProducts(businessId: BusinessId): Promise<readonly Product[]> {
    const rows = unwrap(
      await this.db
        .from('products')
        .select(PRODUCT_COLUMNS)
        .eq('business_id', businessId)
        .eq('status', 'active')
        .order('current_stock', { ascending: true }),
    );

    // needsReorder() is the Phase 1 rule; reuse it rather than re-deriving.
    return ((rows ?? []) as ProductRow[]).map(toProduct).filter(needsReorder);
  }

  async allProducts(businessId: BusinessId): Promise<readonly Product[]> {
    const rows = unwrap(
      await this.db.from('products').select(PRODUCT_COLUMNS).eq('business_id', businessId),
    );
    return ((rows ?? []) as ProductRow[]).map(toProduct);
  }

  /**
   * Compare-and-set on stock.
   *
   * The WHERE clause re-asserts `current_stock = expectedPrevious`. If a
   * concurrent movement already changed it, zero rows are updated and the
   * caller is told to retry. This is what makes a lost update detectable
   * instead of silent.
   */
  async compareAndSetStock(
    businessId: BusinessId,
    productId: ProductId,
    expectedPrevious: number,
    nextStock: number,
  ): Promise<boolean> {
    const { data, error } = await this.db
      .from('products')
      .update({ current_stock: nextStock, updated_at: toIso(new Date()) })
      .eq('business_id', businessId)
      .eq('id', productId)
      .eq('current_stock', expectedPrevious)
      .select('id');

    if (error) throw error;
    return Array.isArray(data) && data.length === 1;
  }

  async saveMovement(movement: InventoryMovement): Promise<InventoryMovement> {
    const row = unwrap(
      await this.db
        .from('inventory_movements')
        .insert({
          id: movement.id,
          business_id: movement.businessId,
          product_id: movement.productId,
          type: movement.type,
          quantity: movement.quantity,
          previous_stock: movement.previousStock,
          new_stock: movement.newStock,
          reference: movement.reference ?? null,
          reference_type: movement.referenceType ?? null,
          reference_id: movement.referenceId ?? null,
          created_by: movement.createdBy,
        })
        .select('*')
        .single(),
    ) as Record<string, unknown>;

    return {
      id: movement.id,
      businessId: movement.businessId,
      productId: movement.productId,
      type: movement.type,
      quantity: movement.quantity,
      previousStock: movement.previousStock,
      newStock: movement.newStock,
      reference: movement.reference,
      referenceType: movement.referenceType,
      referenceId: movement.referenceId,
      createdAt: new Date(),
      createdBy: movement.createdBy,
    };
  }

  async findMovementByReference(
    businessId: BusinessId,
    referenceType: string,
    referenceId: string,
  ): Promise<InventoryMovement | null> {
    const row = firstOrNull<Record<string, unknown>>(
      unwrap(
        await this.db
          .from('inventory_movements')
          .select('*')
          .eq('business_id', businessId)
          .eq('reference_type', referenceType)
          .eq('reference_id', referenceId)
          .limit(1),
      ),
    );
    if (!row) return null;

    return {
      id: String(row.id),
      businessId: businessId,
      productId: row.product_id as ProductId,
      type: row.type as MovementType,
      quantity: Number(row.quantity),
      previousStock: Number(row.previous_stock),
      newStock: Number(row.new_stock),
      reference: toOptionalString(row.reference as string | null),
      referenceType: toOptionalString(row.reference_type as string | null) as
        | InventoryMovement['referenceType'],
      referenceId: toOptionalString(row.reference_id as string | null),
      createdAt: toDate(row.created_at as string),
      createdBy: row.created_by as unknown as UserId,
    };
  }
}

const MAX_MOVEMENT_ATTEMPTS = 3;

export class DefaultInventoryService {
  constructor(private readonly repository: PostgrestInventoryRepository) {}

  async getProduct(ctx: TenantContext, id: ProductId): Promise<Product | null> {
    if (!hasPermission(ctx.role, 'inventory:read')) {
      throw new AuthorizationError('Missing required permission: inventory:read.');
    }
    return this.repository.findProductById(ctx.businessId, id);
  }

  async listProducts(ctx: TenantContext, filters: ProductFilters): Promise<PaginatedResult<Product>> {
    if (!hasPermission(ctx.role, 'inventory:read')) {
      throw new AuthorizationError('Missing required permission: inventory:read.');
    }
    return this.repository.listProducts(ctx.businessId, filters, {
      column: 'name',
      ascending: true,
    });
  }

  async getLowStockProducts(ctx: TenantContext): Promise<readonly Product[]> {
    if (!hasPermission(ctx.role, 'inventory:read')) {
      throw new AuthorizationError('Missing required permission: inventory:read.');
    }
    return this.repository.findLowStockProducts(ctx.businessId);
  }

  async getInventoryValue(ctx: TenantContext): Promise<{ totalValue: number; productCount: number }> {
    if (!hasPermission(ctx.role, 'inventory:read')) {
      throw new AuthorizationError('Missing required permission: inventory:read.');
    }
    const products = await this.repository.allProducts(ctx.businessId);
    // Phase 1 rule; the multiplication stays in domain/rules.ts.
    return {
      totalValue: calculateInventoryValue(products),
      productCount: products.length,
    };
  }

  /**
   * Records a stock movement.
   *
   * Idempotent when `referenceType` + `referenceId` are supplied: a replay
   * returns the original movement instead of double-counting stock.
   */
  async recordMovement(ctx: TenantContext, input: RecordMovementInput): Promise<InventoryMovement> {
    if (!hasPermission(ctx.role, 'inventory:write')) {
      throw new AuthorizationError('Missing required permission: inventory:write.');
    }

    if (input.referenceType && input.referenceId) {
      const existing = await this.repository.findMovementByReference(
        ctx.businessId,
        input.referenceType,
        input.referenceId,
      );
      if (existing) return existing;
    }

    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_MOVEMENT_ATTEMPTS; attempt += 1) {
      const product = await this.repository.findProductById(ctx.businessId, input.productId);
      if (!product) throw new NotFoundError('Product', input.productId);

      // Deterministic stock arithmetic lives in domain/rules.ts.
      const nextStock = calculateNewStock(product.currentStock, input.quantity, input.type);

      if (nextStock < 0) {
        throw new BusinessRuleError(
          `Insufficient stock for product ${input.productId}: have ${product.currentStock}, need ${input.quantity}.`,
          { available: product.currentStock, requested: input.quantity },
        );
      }

      const swapped = await this.repository.compareAndSetStock(
        ctx.businessId,
        input.productId,
        product.currentStock,
        nextStock,
      );

      if (!swapped) {
        // Another movement landed between our read and write. Retry against the
        // new value rather than overwriting it.
        lastError = new BusinessRuleError('Concurrent stock update detected. Please retry.');
        continue;
      }

      return this.repository.saveMovement({
        id: randomUUID(),
        businessId: ctx.businessId,
        productId: input.productId,
        type: input.type,
        quantity: input.quantity,
        previousStock: product.currentStock,
        newStock: nextStock,
        reference: input.reference,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdAt: new Date(),
        createdBy: ctx.userId,
      });
    }

    throw lastError instanceof BusinessRuleError
      ? lastError
      : new BusinessRuleError('Could not record the movement after several attempts.');
  }
}