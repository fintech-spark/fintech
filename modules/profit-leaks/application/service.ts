import type { TenantContext, PaginatedResult, PaginationParams, DateRange } from '@/lib/types';
import type { ProfitLeak, LeakCategory, LeakSeverity, LeakStatus } from '../domain/types';
export interface ProfitLeakService {
  detectLeaks(ctx: TenantContext, period: DateRange): Promise<readonly ProfitLeak[]>;
  list(ctx: TenantContext, filters: LeakFilters): Promise<PaginatedResult<ProfitLeak>>;
  getById(ctx: TenantContext, leakId: string): Promise<ProfitLeak | null>;
  getTotalImpact(ctx: TenantContext): Promise<{ totalMonthly: number; leakCount: number }>;
  updateStatus(ctx: TenantContext, leakId: string, status: LeakStatus): Promise<ProfitLeak>;
}
export interface LeakFilters extends PaginationParams { readonly category?: LeakCategory; readonly severity?: LeakSeverity; readonly status?: LeakStatus; }
