import type { BusinessId, ExpenseId, PaginatedResult } from '@/lib/types';
import type { Expense } from '../domain/types';
import type { ExpenseFilters } from '../application/service';
export interface ExpenseRepository {
  findById(businessId: BusinessId, id: ExpenseId): Promise<Expense | null>;
  save(expense: Expense): Promise<Expense>;
  update(expense: Expense): Promise<Expense>;
  list(businessId: BusinessId, filters: ExpenseFilters): Promise<PaginatedResult<Expense>>;
}
