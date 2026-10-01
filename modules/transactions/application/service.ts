import type { TenantContext, PaginatedResult, PaginationParams, DateRange, TransactionId } from '@/lib/types';
import type { Transaction, TransactionType, TransactionStatus, PaymentMethod } from '../domain/types';
export interface TransactionService {
  create(ctx: TenantContext, input: CreateTransactionInput): Promise<Transaction>;
  getById(ctx: TenantContext, id: TransactionId): Promise<Transaction | null>;
  list(ctx: TenantContext, filters: TransactionFilters): Promise<PaginatedResult<Transaction>>;
  updateStatus(ctx: TenantContext, id: TransactionId, status: TransactionStatus): Promise<Transaction>;
  checkDuplicate(ctx: TenantContext, input: CreateTransactionInput): Promise<Transaction | null>;
}
export interface CreateTransactionInput { readonly type: TransactionType; readonly counterpartyType: 'customer' | 'supplier'; readonly counterpartyId: string; readonly items: readonly CreateTransactionItemInput[]; readonly paymentMethod?: PaymentMethod; readonly reference?: string; readonly notes?: string; readonly transactionDate: Date; }
export interface CreateTransactionItemInput { readonly productId: string; readonly quantity: number; readonly unitPrice: number; readonly discount?: number; readonly tax?: number; }
export interface TransactionFilters extends PaginationParams { readonly type?: TransactionType; readonly status?: TransactionStatus; readonly counterpartyId?: string; readonly dateRange?: DateRange; }
