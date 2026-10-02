// Merchant Brain: expenses module — repository and application service
//
// Implements the Phase 1 ExpenseService / ExpenseRepository interfaces.
// Validation and totals stay deterministic; no floating-point money.

import 'server-only';

import { randomUUID } from 'node:crypto';
import type { BusinessId, ExpenseId, Money, PaginatedResult, TenantContext, UserId } from '@/lib/types';
import { asExpenseId, createMoney } from '@/lib/types';
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
import type {
  Expense,
  ExpenseCategory,
  ExpenseStatus,
  RecurringExpenseConfig,
} from '../domain/types';
import type {
  CategoryTotal,
  CreateExpenseInput,
  ExpenseFilters,
  ExpenseService,
} from '../application/service';

const EXPENSE_COLUMNS = `
  id, business_id, category, amount_minor, currency, description, vendor, reference,
  status, expense_date, is_recurring, recurring_frequency, recurring_next_due_date,
  recurring_end_date, created_by, created_at, updated_at
`;

interface ExpenseRow {
  id: string;
  business_id: string;
  category: ExpenseCategory;
  amount_minor: number;
  currency: Money['currency'];
  description: string;
  vendor: string | null;
  reference: string | null;
  status: ExpenseStatus;
  expense_date: string;
  is_recurring: boolean;
  recurring_frequency: RecurringExpenseConfig['frequency'] | null;
  recurring_next_due_date: string | null;
  recurring_end_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function toExpense(row: ExpenseRow): Expense {
  const recurringConfig =
    row.is_recurring && row.recurring_frequency && row.recurring_next_due_date
      ? {
          frequency: row.recurring_frequency,
          nextDueDate: toDate(row.recurring_next_due_date),
          ...(row.recurring_end_date ? { endDate: toDate(row.recurring_end_date) } : {}),
        }
      : undefined;

  return {
    id: asExpenseId(row.id) as ExpenseId,
    businessId: row.business_id as unknown as BusinessId,
    category: row.category,
    amount: createMoney(row.amount_minor, row.currency),
    description: row.description,
    vendor: toOptionalString(row.vendor),
    reference: toOptionalString(row.reference),
    status: row.status,
    expenseDate: toDate(row.expense_date),
    isRecurring: row.is_recurring,
    ...(recurringConfig ? { recurringConfig } : {}),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    createdBy: row.created_by as unknown as UserId,
  };
}

export class PostgrestExpenseRepository {
  constructor(private readonly db: Db) {}

  async findById(businessId: BusinessId, id: ExpenseId): Promise<Expense | null> {
    const row = firstOrNull<ExpenseRow>(
      unwrap(
        await this.db
          .from('expenses')
          .select(EXPENSE_COLUMNS)
          .eq('business_id', businessId)
          .eq('id', id)
          .limit(1),
      ),
    );
    return row ? toExpense(row) : null;
  }

  async save(expense: Expense, idempotencyKey?: string): Promise<Expense> {
    const row = unwrap(
      await this.db
        .from('expenses')
        .insert({
          id: expense.id,
          business_id: expense.businessId,
          category: expense.category,
          amount_minor: expense.amount.amount,
          currency: expense.amount.currency,
          description: expense.description,
          vendor: expense.vendor ?? null,
          reference: expense.reference ?? null,
          status: expense.status,
          expense_date: toIso(expense.expenseDate),
          is_recurring: expense.isRecurring,
          recurring_frequency: expense.recurringConfig?.frequency ?? null,
          recurring_next_due_date: expense.recurringConfig
            ? toIso(expense.recurringConfig.nextDueDate)
            : null,
          recurring_end_date: expense.recurringConfig?.endDate
            ? toIso(expense.recurringConfig.endDate)
            : null,
          idempotency_key: idempotencyKey ?? null,
          created_by: expense.createdBy,
        })
        .select(EXPENSE_COLUMNS)
        .single(),
    ) as ExpenseRow;

    return toExpense(row);
  }

  async update(expense: Expense): Promise<Expense> {
    const row = unwrap(
      await this.db
        .from('expenses')
        .update({ status: expense.status, updated_at: toIso(new Date()) })
        .eq('business_id', expense.businessId)
        .eq('id', expense.id)
        .select(EXPENSE_COLUMNS)
        .single(),
    ) as ExpenseRow;
    return toExpense(row);
  }

  async list(
    businessId: BusinessId,
    filters: ExpenseFilters,
    sort: { column: string; ascending: boolean },
  ): Promise<PaginatedResult<Expense>> {
    const limit = filters.limit ?? 20;
    const page = filters.page ?? 1;

    let query = this.db
      .from('expenses')
      .select(EXPENSE_COLUMNS, { count: 'exact' })
      .eq('business_id', businessId);

    if (filters.category) query = query.eq('category', filters.category);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.dateRange?.from) query = query.gte('expense_date', toIso(filters.dateRange.from));
    if (filters.dateRange?.to) query = query.lte('expense_date', toIso(filters.dateRange.to));

    const column = sort.column === 'expenseDate' ? 'expense_date' : sort.column;

    const { data, error, count } = await query
      .order(column, { ascending: sort.ascending })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw error;

    const items = ((data ?? []) as ExpenseRow[]).map(toExpense);
    return paginate(items, count ?? items.length, page, limit);
  }

  async totalsByCategory(
    businessId: BusinessId,
    dateRange: { from: Date; to: Date },
  ): Promise<readonly CategoryTotal[]> {
    const { data, error } = await this.db
      .from('expenses')
      .select('category, amount_minor')
      .eq('business_id', businessId)
      .gte('expense_date', toIso(dateRange.from))
      .lte('expense_date', toIso(dateRange.to));

    if (error) throw error;

    const totals = new Map<ExpenseCategory, { total: number; count: number }>();
    for (const row of (data ?? []) as Array<{ category: ExpenseCategory; amount_minor: number }>) {
      const existing = totals.get(row.category) ?? { total: 0, count: 0 };
      existing.total += row.amount_minor;
      existing.count += 1;
      totals.set(row.category, existing);
    }

    return [...totals.entries()].map(([category, value]) => ({
      category,
      total: value.total,
      count: value.count,
    }));
  }

  async findByIdempotencyKey(businessId: BusinessId, key: string): Promise<Expense | null> {
    const row = firstOrNull<ExpenseRow>(
      unwrap(
        await this.db
          .from('expenses')
          .select(EXPENSE_COLUMNS)
          .eq('business_id', businessId)
          .eq('idempotency_key', key)
          .limit(1),
      ),
    );
    return row ? toExpense(row) : null;
  }
}

export class DefaultExpenseService implements ExpenseService {
  constructor(private readonly repository: PostgrestExpenseRepository) {}

  async create(ctx: TenantContext, input: CreateExpenseInput): Promise<Expense> {
    if (!hasPermission(ctx.role, 'expenses:write')) {
      throw new AuthorizationError('Missing required permission: expenses:write.');
    }

    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new BusinessRuleError('Expense amount must be a positive integer in minor units.');
    }

    // Recurrence fields are a Phase 3 addition on top of the Phase 1
    // CreateExpenseInput; narrow rather than editing the contract file.
    const extended = input as typeof input & {
      isRecurring?: boolean;
      recurringFrequency?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
      recurringNextDueDate?: Date;
    };

    if (extended.isRecurring && !extended.recurringFrequency) {
      throw new BusinessRuleError('A recurring expense requires a recurrence frequency.');
    }

    const expense: Expense = {
      id: asExpenseId(randomUUID()) as ExpenseId,
      businessId: ctx.businessId,
      category: input.category,
      amount: createMoney(input.amount, input.currency as Money['currency']),
      description: input.description,
      vendor: input.vendor,
      status: 'pending',
      expenseDate: input.expenseDate,
      isRecurring: extended.isRecurring ?? false,
      ...(extended.recurringFrequency && extended.recurringNextDueDate
        ? {
            recurringConfig: {
              frequency: extended.recurringFrequency,
              nextDueDate: extended.recurringNextDueDate,
            },
          }
        : {}),
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: ctx.userId,
    };

    const key = (input as { idempotencyKey?: string }).idempotencyKey;
    if (key) {
      const existing = await this.repository.findByIdempotencyKey(ctx.businessId, key);
      if (existing) return existing;
    }

    return this.repository.save(expense, key);
  }

  async getById(ctx: TenantContext, id: ExpenseId): Promise<Expense | null> {
    if (!hasPermission(ctx.role, 'expenses:read')) {
      throw new AuthorizationError('Missing required permission: expenses:read.');
    }
    return this.repository.findById(ctx.businessId, id);
  }

  async list(ctx: TenantContext, filters: ExpenseFilters): Promise<PaginatedResult<Expense>> {
    if (!hasPermission(ctx.role, 'expenses:read')) {
      throw new AuthorizationError('Missing required permission: expenses:read.');
    }
    return this.repository.list(ctx.businessId, filters, { column: 'expenseDate', ascending: false });
  }

  async approve(ctx: TenantContext, id: ExpenseId): Promise<Expense> {
    if (!hasPermission(ctx.role, 'expenses:write')) {
      throw new AuthorizationError('Missing required permission: expenses:write.');
    }

    const existing = await this.repository.findById(ctx.businessId, id);
    if (!existing) throw new NotFoundError('Expense', id);

    if (existing.status !== 'pending') {
      throw new BusinessRuleError(`Cannot approve an expense with status "${existing.status}".`);
    }

    return this.repository.update({ ...existing, status: 'approved' });
  }

  async getTotalByCategory(
    ctx: TenantContext,
    dateRange: { from: Date; to: Date },
  ): Promise<readonly CategoryTotal[]> {
    if (!hasPermission(ctx.role, 'expenses:read')) {
      throw new AuthorizationError('Missing required permission: expenses:read.');
    }
    return this.repository.totalsByCategory(ctx.businessId, dateRange);
  }
}