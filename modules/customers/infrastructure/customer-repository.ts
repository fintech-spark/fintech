// Merchant Brain: customers, suppliers, documents and businesses
//
// Read-only repositories and services.
//
// SCOPE NOTE (contract plan §6): the Phase 1 service interfaces for customers,
// suppliers and inventory expose NO create/update methods. Adding them would
// invent API surface, so this file implements only what is declared. Document
// metadata writes ARE declared (upload/updateStatus/approve/reject) and are
// implemented here.

import 'server-only';

import type {
  BusinessId,
  CustomerId,
  DocumentId,
  Money,
  PaginatedResult,
  ProductId,
  SupplierId,
  TenantContext,
  UserId,
} from '@/lib/types';
import { asBusinessId, asCustomerId, asDocumentId, asSupplierId, createMoney } from '@/lib/types';
import { BusinessRuleError, NotFoundError } from '@/lib/errors';
import {
  type Db,
  firstOrNull,
  paginate,
  toDate,
  toIso,
  toOptionalDate,
  toOptionalString,
  unwrap,
} from '@/lib/database/query-helpers';
import { hasPermission } from '@/lib/http/auth-context';
import type {
  Customer,
  Receivable,
  ReceivableStatus,
} from '@/modules/customers/domain/types';
import type { Payable, PayableStatus, Supplier, SupplierPricing } from '@/modules/suppliers/domain/types';
import type { CustomerService, ReceivableFilters } from '@/modules/customers/application/service';
import type { SupplierService } from '@/modules/suppliers/application/service';
import type {
  Document,
  DocumentMetadata,
  DocumentSourceType,
  DocumentStatus,
} from '@/modules/documents/domain/types';
import { DOCUMENT_STATUS_TRANSITIONS } from '@/modules/documents/domain/types';
import type { Business, BusinessMembership, BusinessProfile, BusinessSettings } from '@/modules/businesses/domain/types';
import type { BusinessService } from '@/modules/businesses/application/service';

// ===========================================================================
// Customers
// ===========================================================================

const CUSTOMER_COLUMNS = `
  id, business_id, name, phone, email, address, gstin, status,
  total_purchases_minor, outstanding_balance_minor, currency,
  last_transaction_date, created_at, updated_at
`;
const RECEIVABLE_COLUMNS = `
  id, business_id, customer_id, transaction_id, amount_minor, paid_amount_minor,
  currency, due_date, status, paid_date
`;

interface CustomerRow {
  id: string; business_id: string; name: string; phone: string | null;
  email: string | null; address: string | null; gstin: string | null;
  status: 'active' | 'inactive'; total_purchases_minor: number;
  outstanding_balance_minor: number; currency: Money['currency'];
  last_transaction_date: string | null; created_at: string; updated_at: string;
}

interface ReceivableRow {
  id: string; business_id: string; customer_id: string; transaction_id: string;
  amount_minor: number; paid_amount_minor: number; currency: Money['currency'];
  due_date: string; status: ReceivableStatus; paid_date: string | null;
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: asCustomerId(row.id) as CustomerId,
    businessId: row.business_id as unknown as BusinessId,
    name: row.name,
    phone: toOptionalString(row.phone),
    email: toOptionalString(row.email),
    address: toOptionalString(row.address),
    gstin: toOptionalString(row.gstin),
    status: row.status,
    totalPurchases: createMoney(row.total_purchases_minor, row.currency),
    outstandingBalance: createMoney(row.outstanding_balance_minor, row.currency),
    lastTransactionDate: toOptionalDate(row.last_transaction_date),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toReceivable(row: ReceivableRow): Receivable {
  return {
    id: row.id,
    businessId: row.business_id as unknown as BusinessId,
    customerId: asCustomerId(row.customer_id) as CustomerId,
    transactionId: row.transaction_id,
    amount: createMoney(row.amount_minor, row.currency),
    paidAmount: createMoney(row.paid_amount_minor, row.currency),
    dueDate: toDate(row.due_date),
    status: row.status,
    paidDate: toOptionalDate(row.paid_date),
  };
}

export class PostgrestCustomerRepository {
  constructor(private readonly db: Db) {}

  findById(businessId: BusinessId, id: CustomerId) {
    return this.db
      .from('customers')
      .select(CUSTOMER_COLUMNS)
      .eq('business_id', businessId)
      .eq('id', id)
      .limit(1)
      .then((r) => unwrap(r))
      .then((d) => {
        const row = firstOrNull<CustomerRow>(d);
        return row ? toCustomer(row) : null;
      });
  }

  async list(
    businessId: BusinessId,
    filters: { page?: number; limit?: number; search?: string; status?: 'active' | 'inactive' },
    sort: { column: string; ascending: boolean },
  ): Promise<PaginatedResult<Customer>> {
    const limit = filters.limit ?? 20;
    const page = filters.page ?? 1;

    let query = this.db
      .from('customers')
      .select(CUSTOMER_COLUMNS, { count: 'exact' })
      .eq('business_id', businessId);

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.search) query = query.ilike('name', `%${filters.search}%`);

    const column = sort.column === 'outstanding' ? 'outstanding_balance_minor' : sort.column;
    const { data, error, count } = await query
      .order(column, { ascending: sort.ascending })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw error;
    const items = ((data ?? []) as CustomerRow[]).map(toCustomer);
    return paginate(items, count ?? items.length, page, limit);
  }

  async receivables(
    businessId: BusinessId,
    filters: ReceivableFilters,
  ): Promise<PaginatedResult<Receivable>> {
    const limit = filters.limit ?? 20;
    const page = filters.page ?? 1;

    let query = this.db
      .from('receivables')
      .select(RECEIVABLE_COLUMNS, { count: 'exact' })
      .eq('business_id', businessId);

    if (filters.customerId) query = query.eq('customer_id', filters.customerId);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.dateRange?.from) query = query.gte('due_date', toIso(filters.dateRange.from));
    if (filters.dateRange?.to) query = query.lte('due_date', toIso(filters.dateRange.to));

    const { data, error, count } = await query
      .order('due_date', { ascending: true })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw error;
    const items = ((data ?? []) as ReceivableRow[]).map(toReceivable);
    return paginate(items, count ?? items.length, page, limit);
  }

  async receivableTotals(businessId: BusinessId): Promise<{ total: number; overdue: number }> {
    const { data, error } = await this.db
      .from('receivables')
      .select('amount_minor, paid_amount_minor, status')
      .eq('business_id', businessId);

    if (error) throw error;

    let total = 0;
    let overdue = 0;
    for (const row of (data ?? []) as Array<{ amount_minor: number; paid_amount_minor: number; status: ReceivableStatus }>) {
      const outstanding = row.amount_minor - row.paid_amount_minor;
      if (outstanding <= 0) continue;
      total += outstanding;
      if (row.status === 'overdue') overdue += outstanding;
    }
    return { total, overdue };
  }
}

export class DefaultCustomerService implements CustomerService {
  constructor(private readonly repository: PostgrestCustomerRepository) {}

  async getById(ctx: TenantContext, id: CustomerId) {
    this.require(ctx, 'customers:read');
    return this.repository.findById(ctx.businessId, id);
  }

  async list(ctx: TenantContext, filters: Parameters<CustomerService['list']>[1]) {
    this.require(ctx, 'customers:read');
    return this.repository.list(ctx.businessId, filters, { column: 'name', ascending: true });
  }

  async getBalance(ctx: TenantContext, id: CustomerId) {
    this.require(ctx, 'customers:read');
    const customer = await this.repository.findById(ctx.businessId, id);
    if (!customer) throw new NotFoundError('Customer', id);
    return { outstanding: customer.outstandingBalance.amount, overdue: 0 };
  }

  async getReceivables(ctx: TenantContext, filters: ReceivableFilters) {
    this.require(ctx, 'customers:read');
    return this.repository.receivables(ctx.businessId, filters);
  }

  async getTotalReceivables(ctx: TenantContext) {
    this.require(ctx, 'customers:read');
    return this.repository.receivableTotals(ctx.businessId);
  }

  private require(ctx: TenantContext, permission: Parameters<typeof hasPermission>[1]) {
    if (!hasPermission(ctx.role, permission)) {
      throw new BusinessRuleError(`Missing required permission: ${permission}.`);
    }
  }
}

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
      .eq('business_id', businessId);

    if (error) throw error;

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
        .eq('supplier_id', supplierId),
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
    return this.repository.pricing(ctx.businessId, supplierId);
  }

  private require(ctx: TenantContext, permission: Parameters<typeof hasPermission>[1]) {
    if (!hasPermission(ctx.role, permission)) {
      throw new BusinessRuleError(`Missing required permission: ${permission}.`);
    }
  }
}

// ===========================================================================
// Documents
// ===========================================================================

const DOCUMENT_COLUMNS = `
  id, business_id, source_type, file_name, mime_type, file_size, storage_path,
  status, original_name, content_hash, page_count, language, extraction_id,
  rejection_reason, tags, uploaded_by, uploaded_at, processed_at, updated_at
`;

interface DocumentRow {
  id: string; business_id: string; source_type: DocumentSourceType;
  file_name: string; mime_type: string; file_size: number; storage_path: string;
  status: DocumentStatus; original_name: string | null; content_hash: string | null;
  page_count: number | null; language: string | null; extraction_id: string | null;
  rejection_reason: string | null; tags: string[] | null; uploaded_by: string;
  uploaded_at: string; processed_at: string | null; updated_at: string;
}

function toDocument(row: DocumentRow): Document {
  const metadata: DocumentMetadata = {
    originalName: row.original_name ?? row.file_name,
    contentHash: toOptionalString(row.content_hash),
    pageCount: row.page_count ?? undefined,
    language: toOptionalString(row.language),
    extractionId: toOptionalString(row.extraction_id),
    rejectionReason: toOptionalString(row.rejection_reason),
    tags: row.tags ?? undefined,
  };

  return {
    id: asDocumentId(row.id) as DocumentId,
    businessId: row.business_id as unknown as BusinessId,
    sourceType: row.source_type,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    storagePath: row.storage_path,
    status: row.status,
    metadata,
    uploadedAt: toDate(row.uploaded_at),
    processedAt: toOptionalDate(row.processed_at),
    uploadedBy: row.uploaded_by as unknown as UserId,
  };
}

export class PostgrestDocumentRepository {
  constructor(private readonly db: Db) {}

  findById(businessId: BusinessId, id: DocumentId) {
    return this.db
      .from('documents')
      .select(DOCUMENT_COLUMNS)
      .eq('business_id', businessId)
      .eq('id', id)
      .limit(1)
      .then(unwrap)
      .then((d) => {
        const row = firstOrNull<DocumentRow>(d);
        return row ? toDocument(row) : null;
      });
  }

  async list(
    businessId: BusinessId,
    filters: { page?: number; limit?: number; status?: DocumentStatus; sourceType?: DocumentSourceType; search?: string },
    sort: { column: string; ascending: boolean },
  ): Promise<PaginatedResult<Document>> {
    const limit = filters.limit ?? 20;
    const page = filters.page ?? 1;

    let query = this.db
      .from('documents')
      .select(DOCUMENT_COLUMNS, { count: 'exact' })
      .eq('business_id', businessId);

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.sourceType) query = query.eq('source_type', filters.sourceType);
    if (filters.search) query = query.ilike('file_name', `%${filters.search}%`);

    const column = sort.column === 'uploadedAt' ? 'uploaded_at' : sort.column;
    const { data, error, count } = await query
      .order(column, { ascending: sort.ascending })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw error;
    const items = ((data ?? []) as DocumentRow[]).map(toDocument);
    return paginate(items, count ?? items.length, page, limit);
  }

  async insert(input: {
    id: DocumentId;
    businessId: BusinessId;
    sourceType: DocumentSourceType;
    fileName: string;
    mimeType: string;
    fileSize: number;
    storagePath: string;
    uploadedBy: UserId;
    tags?: readonly string[];
  }): Promise<Document> {
    const row = unwrap(
      await this.db
        .from('documents')
        .insert({
          id: input.id,
          business_id: input.businessId,
          source_type: input.sourceType,
          file_name: input.fileName,
          mime_type: input.mimeType,
          file_size: input.fileSize,
          storage_path: input.storagePath,
          status: 'uploaded',
          original_name: input.fileName,
          tags: input.tags ?? null,
          uploaded_by: input.uploadedBy,
        })
        .select(DOCUMENT_COLUMNS)
        .single(),
    ) as DocumentRow;
    return toDocument(row);
  }

  async setStatus(
    businessId: BusinessId,
    id: DocumentId,
    status: DocumentStatus,
    reason?: string,
  ): Promise<Document> {
    const row = unwrap(
      await this.db
        .from('documents')
        .update({
          status,
          rejection_reason: reason ?? null,
          processed_at: status === 'extracted' ? toIso(new Date()) : null,
          updated_at: toIso(new Date()),
        })
        .eq('business_id', businessId)
        .eq('id', id)
        .select(DOCUMENT_COLUMNS)
        .single(),
    ) as DocumentRow;
    return toDocument(row);
  }
}

/** Implements the declared document write operations (contract plan §3.8). */
export class DefaultDocumentService {
  constructor(private readonly repository: PostgrestDocumentRepository) {}

  async getById(ctx: TenantContext, id: DocumentId): Promise<Document | null> {
    this.require(ctx, 'documents:read');
    return this.repository.findById(ctx.businessId, id);
  }

  async list(
    ctx: TenantContext,
    filters: { page?: number; limit?: number; status?: DocumentStatus; sourceType?: DocumentSourceType; search?: string },
  ) {
    this.require(ctx, 'documents:read');
    return this.repository.list(ctx.businessId, filters, { column: 'uploaded_at', ascending: false });
  }

  /**
   * Registers document metadata.
   *
   * The binary is written to storage by a separate upload step; this records
   * the pointer. `storagePath` is validated against traversal at the route.
   */
  async upload(
    ctx: TenantContext,
    input: {
      fileName: string;
      mimeType: string;
      fileSize: number;
      sourceType: DocumentSourceType;
      storagePath: string;
      tags?: readonly string[];
    },
  ): Promise<Document> {
    this.require(ctx, 'documents:write');

    return this.repository.insert({
      id: asDocumentId(crypto.randomUUID()) as DocumentId,
      businessId: ctx.businessId,
      sourceType: input.sourceType,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      storagePath: input.storagePath,
      uploadedBy: ctx.userId,
      tags: input.tags,
    });
  }

  async updateStatus(
    ctx: TenantContext,
    id: DocumentId,
    status: DocumentStatus,
    reason?: string,
  ): Promise<Document> {
    this.require(ctx, 'documents:write');

    const existing = await this.repository.findById(ctx.businessId, id);
    if (!existing) throw new NotFoundError('Document', id);

    // Phase 1 transition table — no new statuses invented.
    const allowed = DOCUMENT_STATUS_TRANSITIONS[existing.status];
    if (!allowed.includes(status)) {
      throw new BusinessRuleError(
        `Cannot move a document from "${existing.status}" to "${status}".`,
        { from: existing.status, to: status },
      );
    }

    return this.repository.setStatus(ctx.businessId, id, status, reason);
  }

  async approve(ctx: TenantContext, id: DocumentId): Promise<Document> {
    return this.updateStatus(ctx, id, 'approved');
  }

  async reject(ctx: TenantContext, id: DocumentId, reason: string): Promise<Document> {
    return this.updateStatus(ctx, id, 'rejected', reason);
  }

  private require(ctx: TenantContext, permission: Parameters<typeof hasPermission>[1]) {
    if (!hasPermission(ctx.role, permission)) {
      throw new BusinessRuleError(`Missing required permission: ${permission}.`);
    }
  }
}

// ===========================================================================
// Businesses
// ===========================================================================

const BUSINESS_COLUMNS = `
  id, name, type, status, display_name, industry, address, phone, email,
  gstin, pan, currency, fiscal_year_start, timezone, low_stock_threshold,
  overdue_threshold_days, created_at, updated_at
`;

interface BusinessRow {
  id: string; name: string; type: Business['type']; status: Business['status'];
  display_name: string | null; industry: string | null; address: string | null;
  phone: string | null; email: string | null; gstin: string | null; pan: string | null;
  currency: Money['currency']; fiscal_year_start: number; timezone: string;
  low_stock_threshold: number; overdue_threshold_days: number;
  created_at: string; updated_at: string;
}

function toBusiness(row: BusinessRow): Business {
  return {
    id: asBusinessId(row.id) as BusinessId,
    name: row.name,
    type: row.type,
    status: row.status,
    profile: {
      displayName: row.display_name ?? row.name,
      industry: toOptionalString(row.industry),
      address: toOptionalString(row.address),
      phone: toOptionalString(row.phone),
      email: toOptionalString(row.email),
      gstin: toOptionalString(row.gstin),
      pan: toOptionalString(row.pan),
    },
    settings: {
      currency: row.currency,
      fiscalYearStart: row.fiscal_year_start,
      timezone: row.timezone,
      lowStockThreshold: row.low_stock_threshold,
      overdueThresholdDays: row.overdue_threshold_days,
    },
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export class PostgrestBusinessRepository {
  constructor(private readonly db: Db) {}

  async findById(id: BusinessId): Promise<Business | null> {
    const row = firstOrNull<BusinessRow>(
      unwrap(await this.db.from('businesses').select(BUSINESS_COLUMNS).eq('id', id).limit(1)),
    );
    return row ? toBusiness(row) : null;
  }

  async updateProfileColumns(id: BusinessId, profile: Partial<BusinessProfile>): Promise<Business> {
    const patch: Record<string, unknown> = { updated_at: toIso(new Date()) };
    if (profile.displayName !== undefined) patch.display_name = profile.displayName;
    if (profile.industry !== undefined) patch.industry = profile.industry;
    if (profile.address !== undefined) patch.address = profile.address;
    if (profile.phone !== undefined) patch.phone = profile.phone;
    if (profile.email !== undefined) patch.email = profile.email;
    if (profile.gstin !== undefined) patch.gstin = profile.gstin;
    if (profile.pan !== undefined) patch.pan = profile.pan;

    const row = unwrap(
      await this.db.from('businesses').update(patch).eq('id', id).select(BUSINESS_COLUMNS).single(),
    ) as BusinessRow;
    return toBusiness(row);
  }

  async updateSettingColumns(id: BusinessId, settings: Partial<BusinessSettings>): Promise<Business> {
    const patch: Record<string, unknown> = { updated_at: toIso(new Date()) };
    if (settings.currency !== undefined) patch.currency = settings.currency;
    if (settings.fiscalYearStart !== undefined) patch.fiscal_year_start = settings.fiscalYearStart;
    if (settings.timezone !== undefined) patch.timezone = settings.timezone;
    if (settings.lowStockThreshold !== undefined) patch.low_stock_threshold = settings.lowStockThreshold;
    if (settings.overdueThresholdDays !== undefined) {
      patch.overdue_threshold_days = settings.overdueThresholdDays;
    }

    const row = unwrap(
      await this.db.from('businesses').update(patch).eq('id', id).select(BUSINESS_COLUMNS).single(),
    ) as BusinessRow;
    return toBusiness(row);
  }

  async memberships(businessId: BusinessId): Promise<readonly BusinessMembership[]> {
    const rows = unwrap(
      await this.db
        .from('business_members')
        .select('business_id, user_id, role, status, joined_at')
        .eq('business_id', businessId)
        .order('joined_at', { ascending: true }),
    );

    return ((rows ?? []) as Array<{
      business_id: string; user_id: string; role: BusinessMembership['role'];
      status: BusinessMembership['status']; joined_at: string;
    }>).map((row) => ({
      businessId: asBusinessId(row.business_id) as BusinessId,
      userId: row.user_id as unknown as UserId,
      role: row.role,
      status: row.status,
      joinedAt: toDate(row.joined_at),
    }));
  }

  /** Businesses the caller is an active member of, resolved by the database. */
  async listForUser(userId: UserId): Promise<readonly Business[]> {
    const { data, error } = await this.db
      .from('business_members')
      .select('business_id')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) throw error;

    const ids = ((data ?? []) as Array<{ business_id: string }>).map((r) => r.business_id);
    if (ids.length === 0) return [];

    const rows = unwrap(
      await this.db.from('businesses').select(BUSINESS_COLUMNS).in('id', ids),
    );
    return ((rows ?? []) as BusinessRow[]).map(toBusiness);
  }

  /**
   * Businesses the caller may switch to.
   *
   * Read through the RLS-enforced client, so the database itself restricts the
   * result to the caller's own memberships. There is no tenant parameter to
   * forge because RLS supplies the filter.
   */
}

export class DefaultBusinessService implements BusinessService {
  constructor(private readonly repository: PostgrestBusinessRepository) {}

  async getById(ctx: TenantContext): Promise<Business> {
    const business = await this.repository.findById(ctx.businessId);
    if (!business) throw new NotFoundError('Business', ctx.businessId);
    return business;
  }

  async getMembers(ctx: TenantContext) {
    return this.repository.memberships(ctx.businessId);
  }

  async listForUser(userId: UserId): Promise<readonly Business[]> {
    return this.repository.listForUser(userId);
  }

  /** Settings writes require owner/admin — Phase 1 rule `canManageSettings`. */
  async updateProfile(ctx: TenantContext, profile: Partial<BusinessProfile>) {
    if (!hasPermission(ctx.role, 'settings:write')) {
      throw new BusinessRuleError('Missing required permission: settings:write.');
    }
    return this.repository.updateProfileColumns(ctx.businessId, profile);
  }

  async updateSettings(ctx: TenantContext, settings: Partial<BusinessSettings>) {
    if (!hasPermission(ctx.role, 'settings:write')) {
      throw new BusinessRuleError('Missing required permission: settings:write.');
    }
    return this.repository.updateSettingColumns(ctx.businessId, settings);
  }
}
