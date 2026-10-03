import type { BusinessId, PaginatedResult } from '@/lib/types';
import type { ProfitLeak, LeakCategory, LeakSeverity, LeakStatus } from '../domain/types';
import type { LeakFilters } from '../application/service';

/**
 * Persistence contract for detected leaks.
 *
 * Every method is tenant-scoped by an explicit `businessId`. There is no
 * cross-tenant read, no unscoped list and no delete: a leak is an audit record
 * and is resolved or dismissed, never removed.
 */
export interface ProfitLeakRepository {
  findById(businessId: BusinessId, id: string): Promise<ProfitLeak | null>;
  save(leak: ProfitLeak): Promise<ProfitLeak>;
  update(leak: ProfitLeak): Promise<ProfitLeak>;
  list(businessId: BusinessId, filters: LeakFilters): Promise<PaginatedResult<ProfitLeak>>;
  findActiveByCategory(businessId: BusinessId, category: LeakCategory): Promise<readonly ProfitLeak[]>;
  /** Aggregated impact of currently active leaks, in minor units. */
  sumActiveImpact(businessId: BusinessId): Promise<{ totalMinor: number; leakCount: number }>;
}

/** Narrow filter set the repository accepts, so no caller can pass free-form SQL. */
export interface LeakFilterInput {
  readonly category?: LeakCategory;
  readonly severity?: LeakSeverity;
  readonly status?: LeakStatus;
  readonly page: number;
  readonly limit: number;
}