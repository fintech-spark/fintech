import type { BusinessId, ExpenseId, UserId, Money } from '@/lib/types';
export interface Expense {
  readonly id: ExpenseId; readonly businessId: BusinessId; readonly category: ExpenseCategory; readonly amount: Money;
  readonly description: string; readonly vendor?: string; readonly reference?: string; readonly status: ExpenseStatus;
  readonly expenseDate: Date; readonly isRecurring: boolean; readonly recurringConfig?: RecurringExpenseConfig;
  readonly createdAt: Date; readonly updatedAt: Date; readonly createdBy: UserId;
}
export type ExpenseCategory = 'rent' | 'utilities' | 'salaries' | 'supplies' | 'marketing' | 'transportation' | 'insurance' | 'maintenance' | 'taxes' | 'fees' | 'other';
export type ExpenseStatus = 'pending' | 'approved' | 'rejected' | 'paid';
export interface RecurringExpenseConfig { readonly frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'; readonly nextDueDate: Date; readonly endDate?: Date; }
