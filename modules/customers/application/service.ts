import type { TenantContext, PaginatedResult, PaginationParams, CustomerId, DateRange } from '@/lib/types';
import type { Customer, Receivable, ReceivableStatus } from '../domain/types';
export interface CustomerService {
  getById(ctx: TenantContext, id: CustomerId): Promise<Customer | null>;
  list(ctx: TenantContext, filters: CustomerFilters): Promise<PaginatedResult<Customer>>;
  getBalance(ctx: TenantContext, id: CustomerId): Promise<{ outstanding: number; overdue: number }>;
  getReceivables(ctx: TenantContext, filters: ReceivableFilters): Promise<PaginatedResult<Receivable>>;
  getTotalReceivables(ctx: TenantContext): Promise<{ total: number; overdue: number }>;
}
export interface CustomerFilters extends PaginationParams { readonly search?: string; readonly status?: 'active' | 'inactive'; readonly hasOutstanding?: boolean; }
export interface ReceivableFilters extends PaginationParams { readonly customerId?: CustomerId; readonly status?: ReceivableStatus; readonly dateRange?: DateRange; }
