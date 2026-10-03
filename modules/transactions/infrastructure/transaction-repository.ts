// Merchant Brain: transactions module — application service and repository
//
// Implements the interfaces declared in this module during Phase 1. No
// behaviour is invented here: validation, status transitions and totals all
// delegate to domain/rules.ts.

import 'server-only';

import { randomUUID } from 'node:crypto';
import type { BusinessId, PaginatedResult, TenantContext, TransactionId, UserId, Money } from '@/lib/types';
import { asTransactionId, createMoney } from '@/lib/types';
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
  isUniqueViolationError,
} from '@/lib/errors';
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
import { POSTGREST_MAX_ROWS } from '@/lib/bounded-scan';
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

/**
 * Rejects a computed money total that JavaScript cannot represent exactly.
 *
 * `createMoney` throws a bare `TypeError` for a non-integer amount, which is not
 * an `AppError` and so reaches the client as a generic 500 — telling the caller
 * the server broke when in fact the request was out of range. Totals are
 * therefore checked here, where the failure can be reported as the 400 it is.
 */
function assertExactMinorAmount(value: number, field: string): number {
  if (Number.isSafeInteger(value)) return value;
  throw new ValidationError('A monetary total in this request exceeds the supported range.', [
    { field, message: 'Amount exceeds the maximum supported value.' },
  ]);
}

/**
 * Line items per transaction, from `createTransactionSchema`'s `.max(200)`.
 * Used to size item batches against the server's response cap.
 */
const MAX_ITEMS_PER_TRANSACTION = 200;

/**
 * How many transactions' items one query may fetch.
 *
 * PostgREST truncates a response at `POSTGREST_MAX_ROWS`, and the only evidence
 * it did so is a row count sitting at the cap. Fetching a whole page of ids in a
 * single `.in()` would therefore drop line items silently, and a partial ledger
 * is worse than a slow one. Ids are batched so the worst case for each batch
 * provably fits under the cap: a 100-transaction page costs a handful of
 * queries instead of 100, and every item is still returned.
 */
const ITEM_BATCH_SIZE = Math.max(1, Math.floor(POSTGREST_MAX_ROWS / MAX_ITEMS_PER_TRANSACTION));

/**
 * True when `stored` is the same request that produced `requested`.
 *
 * Used to tell an idempotent retry (replay the original) from a key reused for a
 * different transaction (409). Only persisted fields are compared: there is no
 * stored request fingerprint, and migrations are not this module's to change.
 *
 * `notes` is deliberately excluded — it is a free-text annotation rather than a
 * ledger value, so a retry that re-sends it with different wording is still the
 * same request. Server-assigned fields (status, ids, timestamps, author) are
 * excluded for the same reason: the retry cannot know them.
 */
function isSameRequest(stored: Transaction, requested: Transaction): boolean {
  if (
    stored.type !== requested.type ||
    stored.counterpartyType !== requested.counterpartyType ||
    stored.counterpartyId !== requested.counterpartyId ||
    stored.paymentMethod !== requested.paymentMethod ||
    stored.reference !== requested.reference ||
    stored.transactionDate.getTime() !== requested.transactionDate.getTime()
  ) {
    return false;
  }

  if (
    stored.subtotal.amount !== requested.subtotal.amount ||
    stored.discount.amount !== requested.discount.amount ||
    stored.tax.amount !== requested.tax.amount ||
    stored.total.amount !== requested.total.amount ||
    stored.items.length !== requested.items.length
  ) {
    return false;
  }

  return stored.items.every((item, index) => {
    const other = requested.items[index];
    return (
      item.productId === other.productId &&
      item.quantity === other.quantity &&
      item.unitPrice.amount === other.unitPrice.amount &&
      item.discount.amount === other.discount.amount &&
      item.tax.amount === other.tax.amount
    );
  });
}

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

  /** Product ids owned by this tenant, used to validate line-item references. */
  async findOwnedProductIds(
    businessId: BusinessId,
    productIds: readonly string[],
  ): Promise<{ data: Array<{ id: string }> | null; error: unknown }> {
    return this.db
      .from('products')
      .select('id')
      .eq('business_id', businessId)
      .in('id', productIds as string[])
      .limit(productIds.length);
  }

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
    const grouped = await this.loadItemsForTransactions([transactionId]);
    return grouped.get(transactionId) ?? [];
  }

  /**
   * Loads line items for many transactions at once, grouped by transaction id.
   *
   * Replaces the one-query-per-row pattern behind `list` and
   * `findByCounterparty`, which issued up to MAX_PAGE_SIZE extra round trips
   * per page request.
   */
  private async loadItemsForTransactions(
    transactionIds: readonly TransactionId[],
  ): Promise<Map<string, ItemRow[]>> {
    const grouped = new Map<string, ItemRow[]>();
    if (transactionIds.length === 0) return grouped;

    for (let start = 0; start < transactionIds.length; start += ITEM_BATCH_SIZE) {
      const batch = transactionIds.slice(start, start + ITEM_BATCH_SIZE);

      const rows = unwrap(
        await this.db
          .from('transaction_items')
          .select(ITEM_COLUMNS)
          .in('transaction_id', batch)
          .order('id', { ascending: true }),
      );

      for (const row of (rows ?? []) as ItemRow[]) {
        const bucket = grouped.get(row.transaction_id);
        if (bucket) bucket.push(row);
        else grouped.set(row.transaction_id, [row]);
      }
    }

    // A transaction cannot hold more items than the create schema permits. If
    // one does, the batch above hit the server's row cap and this response is
    // incomplete — refuse it rather than return a short ledger.
    for (const [transactionId, items] of grouped) {
      if (items.length > MAX_ITEMS_PER_TRANSACTION) {
        throw new BusinessRuleError(
          `Transaction ${transactionId} has more line items than this endpoint can return.`,
          { subject: 'transaction_items', truncated: true },
        );
      }
    }

    return grouped;
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
    const grouped = await this.loadItemsForTransactions(
      rows.map((row) => asTransactionId(row.id) as TransactionId),
    );
    const items = rows.map((row) => toTransaction(row, grouped.get(row.id) ?? []));

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
    const grouped = await this.loadItemsForTransactions(
      result.map((row) => asTransactionId(row.id) as TransactionId),
    );
    return result.map((row) => toTransaction(row, grouped.get(row.id) ?? []));
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

  /**
   * Confirms every referenced product belongs to this tenant.
   *
   * `transaction_items` has no `business_id` column and its `product_id` foreign
   * key is global, so the FK constraint and the RLS policy (which only inspects
   * the PARENT transaction) both accept a product owned by a different
   * business. Without this check a caller could write a durable cross-tenant
   * pointer into their own ledger. `products` does carry `business_id`, so the
   * ownership question is answerable here.
   */
  private async assertProductsOwnedByTenant(
    ctx: TenantContext,
    productIds: readonly string[],
  ): Promise<void> {
    const unique = Array.from(new Set(productIds));
    if (unique.length === 0) return;

    const { data, error } = await this.repository.findOwnedProductIds(ctx.businessId, unique);

    if (error) throw error;

    const owned = new Set(((data ?? []) as Array<{ id: string }>).map((row) => row.id));
    const foreign = unique.filter((id) => !owned.has(id));

    if (foreign.length > 0) {
      throw new ValidationError('One or more referenced products do not exist.', [
        { field: 'items[].productId', message: 'Unknown or inaccessible product reference.' },
      ]);
    }
  }

  async create(ctx: TenantContext, input: CreateTransactionInput): Promise<Transaction> {
    if (!hasPermission(ctx.role, 'transactions:write' satisfies Permission)) {
      throw new AuthorizationError('Missing required permission: transactions:write.');
    }

    await this.assertProductsOwnedByTenant(
      ctx,
      input.items.map((item) => item.productId),
    );

    const currency = 'INR' as Money['currency'];

    // Deterministic arithmetic lives in domain/rules.ts, never in the route.
    // Every derived amount is checked for exact representability before it is
    // stored, so an out-of-range request is a 400 rather than a driver 500.
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
          assertExactMinorAmount(
            unitPrice.amount * quantity - discount.amount + tax.amount,
            'items[].unitPrice',
          ),
          currency,
        ),
      };
    });

    const subtotal = assertExactMinorAmount(
      items.reduce((sum, item) => sum + item.unitPrice.amount * item.quantity, 0),
      'items',
    );
    const discountTotal = items.reduce((sum, item) => sum + item.discount.amount, 0);
    const taxTotal = items.reduce((sum, item) => sum + item.tax.amount, 0);
    const total = assertExactMinorAmount(subtotal - discountTotal + taxTotal, 'items');

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
    if (!idempotencyKey) {
      return this.repository.save(transaction);
    }

    // A key already used in this tenant means the same request, so the stored
    // transaction is replayed rather than duplicated. A key already used for a
    // *different* body is a client bug and must not silently return the wrong
    // record, so that case is a conflict.
    const replay = (existing: Transaction | null): Transaction => {
      if (!existing) {
        throw new ConflictError('This idempotency key is already in use by another request.');
      }
      if (!isSameRequest(existing, transaction)) {
        throw new ConflictError(
          'This idempotency key was already used for a different transaction.',
          { idempotencyKey },
        );
      }
      return existing;
    };

    const prior = await this.repository.findByIdempotencyKey(ctx.businessId, idempotencyKey);
    if (prior) return replay(prior);

    try {
      return await this.repository.save({
        ...transaction,
        idempotencyKey,
      } as Transaction);
    } catch (error) {
      // A concurrent request carrying the same key won the race on the partial
      // unique index idx_transactions_idempotency. That is a replay, not a
      // failure, so the winner is read back rather than reported as a conflict.
      if (isUniqueViolationError(error)) {
        return replay(await this.repository.findByIdempotencyKey(ctx.businessId, idempotencyKey));
      }
      throw error;
    }
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