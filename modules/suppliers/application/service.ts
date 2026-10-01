import type { TenantContext, PaginatedResult, PaginationParams, SupplierId, DateRange } from '@/lib/types';
import type { Supplier, Payable, SupplierPricing, PayableStatus } from '../domain/types';
export interface SupplierService {
  getById(ctx: TenantContext, id: SupplierId): Promise<Supplier | null>;
  list(ctx: TenantContext, filters: SupplierFilters): Promise<PaginatedResult<Supplier>>;
  getPayables(ctx: TenantContext, filters: PayableFilters): Promise<PaginatedResult<Payable>>;
  getTotalPayables(ctx: TenantContext): Promise<{ total: number; overdue: number }>;
  getPricing(ctx: TenantContext, supplierId: SupplierId): Promise<readonly SupplierPricing[]>;
}
export interface SupplierFilters extends PaginationParams { readonly search?: string; readonly status?: 'active' | 'inactive'; readonly hasOutstanding?: boolean; }
export interface PayableFilters extends PaginationParams { readonly supplierId?: SupplierId; readonly status?: PayableStatus; readonly dateRange?: DateRange; }
