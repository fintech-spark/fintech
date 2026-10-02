// Merchant Brain: transactions module — application service and repository
//
// Implements the interfaces declared in this module during Phase 1. No
// behaviour is invented here: validation, status transitions and totals all
// delegate to domain/rules.ts.

import 'server-only';

import { randomUUID } from 'node:crypto';
import type { BusinessId, PaginatedResult, TenantContext, TransactionId, UserId, Money } from '@/lib/types';
import { asTransactionId, createMoney } from '@/lib/types';
import { AuthorizationError, BusinessRuleError, ConflictError, NotFoundError } from '@/lib/errors';
import {
  type Db,
  firstOrNull,
  paginate,
  requireFound,
  toDate,
  toIso,
  toOptionalString,
  unwrap,
} from '@/lib/database/query-helpers';
import type { Permission } from '@/modules/auth/domain/types';
import { hasPermission } from '@/lib/http/auth-context';
import type {
  Transaction,
  TransactionItem,
  TransactionStatus,
  TransactionType,
  PaymentMethod,
} from '../domain/types';
import { canTransitionTo, isDuplicateCandidate } from '../domain/rules';
import type {
  CreateTransactionInput,
  CreateTransactionItemInput,
  TransactionFilters,
  TransactionService,
} from '../application/service';

const TRANSACTION_COLUMNS = `
  id, business_id, type, status, counterparty_type, counterparty_id,
  subtotal_minor, discount_minor, tax_minor, total_minor, currency,
  payment_method, reference, notes, transaction_date, created_at, updated_at, created_by
`;

const ITEM_COLUMNS = `
  id, transaction_id, product_id, product_name, quantity,
  unit_price_minor, discount_minor, tax_minor, total_minor
`;

interface TransactionRow {
  id: string;
  business_id: string;
  type: TransactionType;
  status: TransactionStatus;
  counterparty_type: 'customer' | 'supplier';
  counterparty_id: string;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  currency: Money['currency'];
  payment_method: PaymentMethod | null;
  reference: string | null;
  notes: string | null;
  transaction_date: string;
  created_at: string;
  updated_at: string;
  created_by: string;
}

interface ItemRow {
  id: string;
  transaction_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
}

/** Maps a DB row plus its items into the domain aggregate. */
function toTransaction(row: TransactionRow, items: readonly ItemRow[]): Transaction {
  return {
    id: asTransactionId(row.id) as TransactionId,
    businessId: row.business_id as unknown as BusinessId,
    type: row.type,
    status: row.status,
    counterpartyType: row.counterparty_type,
    counterpartyId: row.counterparty_id as Transaction['counterpartyId'],
    items: items.map<TransactionItem>((item) => ({
      productId: (item.product_id ?? '') as TransactionItem['productId'],
      productName: item.product_name,
      quantity: Number(item.quantity),
      unitPrice: createMoney(item.unit_price_minor, row.currency),
      discount: createMoney(item.discount_minor, row.currency),
      tax: createMoney(item.tax_minor, row.currency),
      total: createMoney(item.total_minor, row.currency),
    })),
    subtotal: createMoney(row.subtotal_minor, row.currency),
    discount: createMoney(row.discount_minor, row.currency),
    tax: createMoney(row.tax_minor, row.currency),
    total: createMoney(row.total_minor, row.currency),
    paymentMethod: toOptionalString(row.payment_method) as PaymentMethod | undefined,
    reference: toOptionalString(row.reference),
    notes: toOptionalString(row.notes),
    transactionDate: toDate(row.transaction_date),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    createdBy: row.created_by as unknown as UserId,
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class PostgrestTransactionRepository {
  constructor(private readonly db: Db) {}

  async findById(businessId: BusinessId, id: TransactionId): Promise<Transaction | null> {
    const row = firstOrNull<TransactionRow>(
      unwrap(
        await this.db
          .from('transactions')
          .select(TRANSACTION_COLUMNS)
          .eq('business_id', businessId)
          .eq('id', id)
          .limit(1),
      ),
    );
    if (!row) return null;
    return toTransaction(row, await this.loadItems(id));
  }

  private async loadItems(transactionId: TransactionId): Promise<readonly ItemRow[]> {
    const items = unwrap(
      await this.db
        .from('transaction_items')
        .select(ITEM_COLUMNS)
        .eq('transaction_id', transactionId)
        .order('id', { ascending: true }),
    );
    return (items ?? []) as ItemRow[];
  }

  /**
   * Inserts a transaction and its items.
   *
   * `id` is generated server-side. `business_id` comes from the resolved tenant
   * context, never from the request body, and migration 0004's
   * `prevent_business_id_mutation()` trigger blocks any later reassignment.
   */
  async save(transaction: Transaction): Promise<Transaction> {
    const idempotencyKey = (transaction as { idempotencyKey?: string }).idempotencyKey;
    const row = unwrap(
      await this.db
        .from('transactions')
        .insert({
          id: transaction.id,
          business_id: transaction.businessId,
          type: transaction.type,
          status: transaction.status,
          counterparty_type: transaction.counterpartyType,
          counterparty_id: transaction.counterpartyId,
          subtotal_minor: transaction.subtotal.amount,
          discount_minor: transaction.discount.amount,
          tax_minor: transaction.tax.amount,
          total_minor: transaction.total.amount,
          currency: transaction.total.currency,
          payment_method: transaction.paymentMethod ?? null,
          reference: transaction.reference ?? null,
          notes: transaction.notes ?? null,
          transaction_date: toIso(transaction.transactionDate),
          created_by: transaction.createdBy,
          idempotency_key: idempotencyKey ?? null,
        })
        .select(TRANSACTION_COLUMNS)
        .single(),
    ) as TransactionRow;

    const itemRows = transaction.items.map((item) => ({
      id: randomUUID(),
      transaction_id: row.id,
      product_id: item.productId,
      product_name: item.productName,
      quantity: item.quantity,
      unit_price_minor: item.unitPrice.amount,
      discount_minor: item.discount.amount,
      tax_minor: item.tax.amount,
      total_minor: item.total.amount,
    }));

    if (itemRows.length > 0) {
      unwrap(await this.db.from('transaction_items').insert(itemRows));
    }

    return toTransaction(row, await this.loadItems(transaction.id));
  }

  async update(transaction: Transaction): Promise<Transaction> {
    const row = unwrap(
      await this.db
        .from('transactions')
        .update({ status: transaction.status, updated_at: toIso(new Date()) })
        .eq('business_id', transaction.businessId)
        .eq('id', transaction.id)
        .select(TRANSACTION_COLUMNS)
        .single(),
    ) as TransactionRow;

    return toTransaction(row, await this.loadItems(transaction.id));
  }

  async list(
    businessId: BusinessId,
    filters: TransactionFilters,
    sort: { column: string; ascending: boolean },
  ): Promise<PaginatedResult<Transaction>> {
    const limit = filters.limit ?? 20;
    const page = filters.page ?? 1;

    let query = this.db
      .from('transactions')
      .select(TRANSACTION_COLUMNS, { count: 'exact' })
      .eq('business_id', businessId);

    if (filters.type) query = query.eq('type', filters.type);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.counterpartyId) query = query.eq('counterparty_id', filters.counterpartyId);
    if (filters.dateRange?.from) query = query.gte('transaction_date', toIso(filters.dateRange.from));
    if (filters.dateRange?.to) query = query.lte('transaction_date', toIso(filters.dateRange.to));

    const { data, error, count } = await query
      // `sort.column` is a literal chosen by resolveSort's allowlist, never raw input.
      .order(sort.column === 'transactionDate' ? 'transaction_date' : sort.column, {
        ascending: sort.ascending,
      })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw error;

    const rows = (data ?? []) as TransactionRow[];
    const items = await Promise.all(rows.map((row) => this.loadItems(asTransactionId(row.id) as TransactionId)
      .then((loaded) => toTransaction(row, loaded))));

    return paginate(items, count ?? items.length, page, limit);
  }

  async findByCounterparty(
    businessId: BusinessId,
    counterpartyId: string,
    limit = 5,
  ): Promise<readonly Transaction[]> {
    const rows = unwrap(
      await this.db
        .from('transactions')
        .select(TRANSACTION_COLUMNS)
        .eq('business_id', businessId)
        .eq('counterparty_id', counterpartyId)
        .order('transaction_date', { ascending: false })
        .limit(limit),
    );

    const result = (rows ?? []) as TransactionRow[];
    return Promise.all(
      result.map((row: TransactionRow) =>
        this.loadItems(asTransactionId(row.id) as TransactionId).then((items: readonly ItemRow[]) =>
          toTransaction(row, items),
        ),
      ),
    );
  }

  async findByIdempotencyKey(businessId: BusinessId, key: string): Promise<Transaction | null> {
    const row = firstOrNull<TransactionRow>(
      unwrap(
        await this.db
          .from('transactions')
          .select(TRANSACTION_COLUMNS)
          .eq('business_id', businessId)
          .eq('idempotency_key', key)
          .limit(1),
      ),
    );
    return row ? toTransaction(row, await this.loadItems(asTransactionId(row.id) as TransactionId)) : null;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DefaultTransactionService implements TransactionService {
  // The concrete repository is required here rather than the interface: the
  // Phase 1 `TransactionRepository` interface predates the sort argument that
  // `lib/http/params.resolveSort` needs, and widening it would mean editing a
  // Phase 1 contract file.
  constructor(private readonly repository: PostgrestTransactionRepository) {}

  async create(ctx: TenantContext, input: CreateTransactionInput): Promise<Transaction> {
    if (!hasPermission(ctx.role, 'transactions:write' satisfies Permission)) {
      throw new AuthorizationError('Missing required permission: transactions:write.');
    }

    const currency = 'INR' as Money['currency'];

    // Deterministic arithmetic lives in domain/rules.ts, never in the route.
    const items = input.items.map<TransactionItem>((item: CreateTransactionItemInput) => {
      const unitPrice = createMoney(item.unitPrice, currency);
      const discount = createMoney(item.discount ?? 0, currency);
      const tax = createMoney(item.tax ?? 0, currency);
      const quantity = item.quantity;

      return {
        productId: item.productId as TransactionItem['productId'],
        // Product name is resolved by the repository layer in a later phase;
        // the stored name is a stable placeholder derived from the id.
        productName: item.productId,
        quantity,
        unitPrice,
        discount,
        tax,
        total: createMoney(
          unitPrice.amount * quantity - discount.amount + tax.amount,
          currency,
        ),
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.unitPrice.amount * item.quantity, 0);
    const discountTotal = items.reduce((sum, item) => sum + item.discount.amount, 0);
    const taxTotal = items.reduce((sum, item) => sum + item.tax.amount, 0);
    const total = subtotal - discountTotal + taxTotal;

    if (total < 0) {
      throw new BusinessRuleError('Transaction total cannot be negative.');
    }

    const transaction: Transaction = {
      id: asTransactionId(randomUUID()) as TransactionId,
      businessId: ctx.businessId,
      type: input.type,
      status: 'draft',
      counterpartyType: input.counterpartyType,
      counterpartyId: input.counterpartyId as Transaction['counterpartyId'],
      items,
      subtotal: createMoney(subtotal, currency),
      discount: createMoney(discountTotal, currency),
      tax: createMoney(taxTotal, currency),
      total: createMoney(total, currency),
      paymentMethod: input.paymentMethod,
      reference: input.reference,
      notes: input.notes,
      transactionDate: input.transactionDate,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: ctx.userId,
    };

    const idempotencyKey = (input as { idempotencyKey?: string }).idempotencyKey;
    return this.repository.save({
      ...transaction,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    } as Transaction);
  }

  async getById(ctx: TenantContext, id: TransactionId): Promise<Transaction | null> {
    if (!hasPermission(ctx.role, 'transactions:read')) {
      throw new AuthorizationError('Missing required permission: transactions:read.');
    }
    return this.repository.findById(ctx.businessId, id);
  }

  async list(ctx: TenantContext, filters: TransactionFilters): Promise<PaginatedResult<Transaction>> {
    if (!hasPermission(ctx.role, 'transactions:read')) {
      throw new AuthorizationError('Missing required permission: transactions:read.');
    }
    return this.repository.list(ctx.businessId, filters, { column: 'transactionDate', ascending: false });
  }

  async updateStatus(
    ctx: TenantContext,
    id: TransactionId,
    status: TransactionStatus,
  ): Promise<Transaction> {
    if (!hasPermission(ctx.role, 'transactions:write')) {
      throw new AuthorizationError('Missing required permission: transactions:write.');
    }

    const existing = await this.repository.findById(ctx.businessId, id);
    if (!existing) {
      throw new NotFoundError('Transaction', id);
    }

    // Phase 1 transition table: draft → confirmed|voided, confirmed → completed|voided.
    if (!canTransitionTo(existing.status, status)) {
      throw new BusinessRuleError(
        `Cannot move a transaction from "${existing.status}" to "${status}".`,
        { from: existing.status, to: status },
      );
    }

    return this.repository.update({ ...existing, status });
  }

  async checkDuplicate(ctx: TenantContext, input: CreateTransactionInput): Promise<Transaction | null> {
    if (!hasPermission(ctx.role, 'transactions:read')) {
      throw new AuthorizationError('Missing required permission: transactions:read.');
    }

    const currency = 'INR' as Money['currency'];
    const probe: Transaction = {
      id: asTransactionId('probe') as TransactionId,
      businessId: ctx.businessId,
      type: input.type,
      status: 'draft',
      counterpartyType: input.counterpartyType,
      counterpartyId: input.counterpartyId as Transaction['counterpartyId'],
      items: [],
      subtotal: createMoney(0, currency),
      discount: createMoney(0, currency),
      tax: createMoney(0, currency),
      total: createMoney(
        input.items.reduce(
          (sum, item) => sum + item.unitPrice * item.quantity - (item.discount ?? 0) + (item.tax ?? 0),
          0,
        ),
        currency,
      ),
      paymentMethod: input.paymentMethod,
      transactionDate: input.transactionDate,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: ctx.userId,
    };

    const candidates = await this.repository.findByCounterparty(
      ctx.businessId,
      input.counterpartyId,
    );

    return candidates.find((candidate) => isDuplicateCandidate(probe, candidate)) ?? null;
  }
}

export { requireFound, ConflictError };