import type { TenantContext, PaginatedResult, PaginationParams, DateRange, UserId } from '@/lib/types';
import type { AuditEntry, AuditAction, AuditResourceType } from '../domain/types';
export interface AuditService {
  log(ctx: TenantContext, input: LogAuditInput): Promise<AuditEntry>;
  list(ctx: TenantContext, filters: AuditFilters): Promise<PaginatedResult<AuditEntry>>;
  getByResource(ctx: TenantContext, resourceType: AuditResourceType, resourceId: string): Promise<readonly AuditEntry[]>;
}
export interface LogAuditInput { readonly action: AuditAction; readonly resourceType: AuditResourceType; readonly resourceId: string; readonly before?: Record<string, unknown>; readonly after?: Record<string, unknown>; readonly metadata?: Record<string, unknown>; }
export interface AuditFilters extends PaginationParams { readonly userId?: UserId; readonly action?: AuditAction; readonly resourceType?: AuditResourceType; readonly dateRange?: DateRange; }
