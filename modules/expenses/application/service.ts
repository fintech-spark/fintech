import type { TenantContext, PaginatedResult, PaginationParams, DateRange, ExpenseId } from '@/lib/types';
import type { Expense, ExpenseCategory, ExpenseStatus } from '../domain/types';
export interface ExpenseService {
  create(ctx: TenantContext, input: CreateExpenseInput): Promise<Expense>;
  getById(ctx: TenantContext, id: ExpenseId): Promise<Expense | null>;
  list(ctx: TenantContext, filters: ExpenseFilters): Promise<PaginatedResult<Expense>>;
  approve(ctx: TenantContext, id: ExpenseId): Promise<Expense>;
  getTotalByCategory(ctx: TenantContext, dateRange: DateRange): Promise<readonly CategoryTotal[]>;
}
export interface CreateExpenseInput { readonly category: ExpenseCategory; readonly amount: number; readonly currency: string; readonly description: string; readonly vendor?: string; readonly expenseDate: Date; }
export interface ExpenseFilters extends PaginationParams { readonly category?: ExpenseCategory; readonly status?: ExpenseStatus; readonly dateRange?: DateRange; }
export interface CategoryTotal { readonly category: ExpenseCategory; readonly total: number; readonly count: number; }
