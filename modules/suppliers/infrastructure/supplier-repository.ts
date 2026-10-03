// Merchant Brain: suppliers read repository and service
//
// Read-only. The Phase 1 SupplierService interface declares no create or update
// method (contract plan section 6); adding one would invent API surface.

import 'server-only';

import type {
  BusinessId,
  Money,
  PaginatedResult,
  ProductId,
  SupplierId,
  TenantContext,
} from '@/lib/types';
import { asSupplierId, createMoney } from '@/lib/types';
import { AuthorizationError, NotFoundError } from '@/lib/errors';
import { MAX_LEDGER_SCAN, MAX_PRICING_SCAN, assertScanWithinLimit } from '@/lib/bounded-scan';
import {
  type Db,
  firstOrNull,
  paginate,
  toDate,
  toOptionalDate,
  toOptionalString,
  unwrap,
} from '@/lib/database/query-helpers';
import { hasPermission } from '@/lib/http/auth-context';

import type { Payable, PayableStatus, Supplier, SupplierPricing } from '@/modules/suppliers/domain/types';
import type { SupplierService } from '@/modules/suppliers/application/service';

// ===========================================================================
// Suppliers
// ===========================================================================

const SUPPLIER_COLUMNS = `
  id, business_id, name, contact_name, phone, email, address, gstin, status,
  total_purchases_minor, outstanding_payable_minor, currency,
  last_transaction_date, created_at, updated_at
`;
const PAYABLE_COLUMNS = `
  id, business_id, supplier_id, transaction_id, amount_minor, paid_amount_minor,
  currency, due_date, status, paid_date
`;
const PRICING_COLUMNS = `supplier_id, product_id, unit_price_minor, currency, min_order_quantity, last_updated`;

interface SupplierRow {
  id: string; business_id: string; name: string; contact_name: string | null;
  phone: string | null; email: string | null; address: string | null;
  gstin: string | null; status: 'active' | 'inactive';
  total_purchases_minor: number; outstanding_payable_minor: number;
  currency: Money['currency']; last_transaction_date: string | null;
  created_at: string; updated_at: string;
}

interface PayableRow {
  id: string; business_id: string; supplier_id: string; transaction_id: string;
  amount_minor: number; paid_amount_minor: number; currency: Money['currency'];
  due_date: string; status: PayableStatus; paid_date: string | null;
}

function toSupplier(row: SupplierRow): Supplier {
  return {
    id: asSupplierId(row.id) as SupplierId,
    businessId: row.business_id as unknown as BusinessId,
    name: row.name,
    contactName: toOptionalString(row.contact_name),
    phone: toOptionalString(row.phone),
    email: toOptionalString(row.email),
    address: toOptionalString(row.address),
    gstin: toOptionalString(row.gstin),
    status: row.status,
    totalPurchases: createMoney(row.total_purchases_minor, row.currency),
    outstandingPayable: createMoney(row.outstanding_payable_minor, row.currency),
    lastTransactionDate: toOptionalDate(row.last_transaction_date),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toPayable(row: PayableRow): Payable {
  return {
    id: row.id,
    businessId: row.business_id as unknown as BusinessId,
    supplierId: asSupplierId(row.supplier_id) as SupplierId,
    transactionId: row.transaction_id,
    amount: createMoney(row.amount_minor, row.currency),
    paidAmount: createMoney(row.paid_amount_minor, row.currency),
    dueDate: toDate(row.due_date),
    status: row.status,
    paidDate: toOptionalDate(row.paid_date),
  };
}

export class PostgrestSupplierRepository {
  constructor(private readonly db: Db) {}

  findById(businessId: BusinessId, id: SupplierId) {
    return this.db
      .from('suppliers')
      .select(SUPPLIER_COLUMNS)
      .eq('business_id', businessId)
      .eq('id', id)
      .limit(1)
      .then(unwrap)
      .then((d) => {
        const row = firstOrNull<SupplierRow>(d);
        return row ? toSupplier(row) : null;
      });
  }

  async list(
    businessId: BusinessId,
    filters: { page?: number; limit?: number; search?: string; status?: 'active' | 'inactive' },
    sort: { column: string; ascending: boolean },
  ): Promise<PaginatedResult<Supplier>> {
    const limit = filters.limit ?? 20;
    const page = filters.page ?? 1;

    let query = this.db
      .from('suppliers')
      .select(SUPPLIER_COLUMNS, { count: 'exact' })
      .eq('business_id', businessId);

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.search) query = query.ilike('name', `%${filters.search}%`);

    const column = sort.column === 'outstanding' ? 'outstanding_payable_minor' : sort.column;
    const { data, error, count } = await query
      .order(column, { ascending: sort.ascending })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw error;
    const items = ((data ?? []) as SupplierRow[]).map(toSupplier);
    return paginate(items, count ?? items.length, page, limit);
  }

  async payables(
    businessId: BusinessId,
    filters: { page?: number; limit?: number; supplierId?: SupplierId; status?: PayableStatus },
  ): Promise<PaginatedResult<Payable>> {
    const limit = filters.limit ?? 20;
    const page = filters.page ?? 1;

    let query = this.db
      .from('payables')
      .select(PAYABLE_COLUMNS, { count: 'exact' })
      .eq('business_id', businessId);

    if (filters.supplierId) query = query.eq('supplier_id', filters.supplierId);
    if (filters.status) query = query.eq('status', filters.status);

    const { data, error, count } = await query
      .order('due_date', { ascending: true })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw error;
    const items = ((data ?? []) as PayableRow[]).map(toPayable);
    return paginate(items, count ?? items.length, page, limit);
  }

  async payableTotals(businessId: BusinessId): Promise<{ total: number; overdue: number }> {
    const { data, error } = await this.db
      .from('payables')
      .select('amount_minor, paid_amount_minor, status')
      .eq('business_id', businessId)
      .range(0, MAX_LEDGER_SCAN);

    if (error) throw error;

    assertScanWithinLimit((data ?? []).length, MAX_LEDGER_SCAN, 'The payables ledger');

    let total = 0;
    let overdue = 0;
    for (const row of (data ?? []) as Array<{ amount_minor: number; paid_amount_minor: number; status: PayableStatus }>) {
      const outstanding = row.amount_minor - row.paid_amount_minor;
      if (outstanding <= 0) continue;
      total += outstanding;
      if (row.status === 'overdue') overdue += outstanding;
    }
    return { total, overdue };
  }

  async pricing(businessId: BusinessId, supplierId: SupplierId): Promise<readonly SupplierPricing[]> {
    const rows = unwrap(
      await this.db
        .from('supplier_pricing')
        .select(PRICING_COLUMNS)
        .eq('business_id', businessId)
        .eq('supplier_id', supplierId)
        .range(0, MAX_PRICING_SCAN),
    );

    assertScanWithinLimit(
      (rows ?? []).length,
      MAX_PRICING_SCAN,
      'This supplier\'s price list',
    );

    return ((rows ?? []) as Array<{
      supplier_id: string; product_id: string; unit_price_minor: number;
      currency: Money['currency']; min_order_quantity: number | null; last_updated: string;
    }>).map((row) => ({
      supplierId: asSupplierId(row.supplier_id) as SupplierId,
      productId: row.product_id as unknown as ProductId,
      unitPrice: createMoney(row.unit_price_minor, row.currency),
      minOrderQuantity: row.min_order_quantity ?? undefined,
      lastUpdated: toDate(row.last_updated),
    }));
  }
}

export class DefaultSupplierService implements SupplierService {
  constructor(private readonly repository: PostgrestSupplierRepository) {}

  async getById(ctx: TenantContext, id: SupplierId) {
    this.require(ctx, 'suppliers:read');
    return this.repository.findById(ctx.businessId, id);
  }

  async list(ctx: TenantContext, filters: Parameters<SupplierService['list']>[1]) {
    this.require(ctx, 'suppliers:read');
    return this.repository.list(ctx.businessId, filters, { column: 'name', ascending: true });
  }

  async getPayables(ctx: TenantContext, filters: Parameters<SupplierService['getPayables']>[1]) {
    this.require(ctx, 'suppliers:read');
    return this.repository.payables(ctx.businessId, filters);
  }

  async getTotalPayables(ctx: TenantContext) {
    this.require(ctx, 'suppliers:read');
    return this.repository.payableTotals(ctx.businessId);
  }

  async getPricing(ctx: TenantContext, supplierId: SupplierId) {
    this.require(ctx, 'suppliers:read');

    // Confirm the supplier resolves inside this tenant first. Without it a
    // foreign or unknown supplierId returned `200 []`, indistinguishable from a
    // real supplier with an empty price list — and inconsistent with
    // GET /suppliers/:id, which answers 404 for the same condition. The
    // business_id filter below already prevents reading another tenant's rows;
    // this makes the response agree with the rest of the supplier endpoints.
    const found = await this.repository.findById(ctx.businessId, supplierId);
    if (!found) throw new NotFoundError('Supplier', supplierId);

    return this.repository.pricing(ctx.businessId, supplierId);
  }

  private require(ctx: TenantContext, permission: Parameters<typeof hasPermission>[1]) {
    if (!hasPermission(ctx.role, permission)) {
      throw new AuthorizationError(`Missing required permission: ${permission}.`);
    }
  }
}

