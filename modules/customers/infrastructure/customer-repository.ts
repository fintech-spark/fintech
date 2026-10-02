// Merchant Brain: customers read repository and service
//
// Read-only. The Phase 1 CustomerService interface declares no create or update
// method (contract plan section 6); adding one would invent API surface.

import 'server-only';

import type {
  BusinessId,
  CustomerId,
  Money,
  PaginatedResult,
  TenantContext,
} from '@/lib/types';
import { asCustomerId, createMoney } from '@/lib/types';
import { AuthorizationError, NotFoundError } from '@/lib/errors';
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
import type { CustomerService, ReceivableFilters } from '@/modules/customers/application/service';

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
      throw new AuthorizationError(`Missing required permission: ${permission}.`);
    }
  }
}

