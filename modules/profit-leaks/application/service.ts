import type { PaginatedResult, PaginationParams, TenantContext } from '@/lib/types';
import type { LeakCategory, LeakDetectionReport, LeakSeverity, LeakStatus, ProfitLeak } from '../domain/types';

/** Filters accepted by the leak list endpoint. */
export interface LeakFilters extends PaginationParams {
  readonly category?: LeakCategory;
  readonly severity?: LeakSeverity;
  readonly status?: LeakStatus;
}

/**
 * Application contract for the profit-leak engine.
 *
 * `detectLeaks` returns the leaks alone, for simple consumers. `analyze` returns
 * the full report including suppressed detectors, which is what an AI tool or a
 * "why am I seeing this?" panel needs in order to explain an absence as well as a
 * presence. Both are read-and-write over the same tenant scope.
 */
export interface ProfitLeakService {
  /** Run every detector and return only the leaks that fired. */
  detectLeaks(ctx: TenantContext, period: { from: Date; to: Date }): Promise<readonly ProfitLeak[]>;

  /**
   * Run every detector, persist what fired, and return the full report.
   * Safe to call repeatedly over the same period: leak ids are deterministic, so
   * a rerun updates rather than duplicates.
   */
  analyze(
    ctx: TenantContext,
    period: { from: Date; to: Date },
  ): Promise<LeakDetectionReport>;

  list(ctx: TenantContext, filters: LeakFilters): Promise<PaginatedResult<ProfitLeak>>;
  getById(ctx: TenantContext, leakId: string): Promise<ProfitLeak | null>;

  /** Aggregate impact of currently active leaks, in minor units. */
  getTotalImpact(ctx: TenantContext): Promise<{ total: number; leakCount: number }>;

  /**
   * Change a leak's workflow status.
   * Throws `NotFoundError` when the leak belongs to another tenant, so a
   * cross-tenant attempt fails closed rather than returning someone else's data.
   */
  updateStatus(ctx: TenantContext, leakId: string, status: LeakStatus): Promise<ProfitLeak>;
}

export type { ProfitLeak, LeakDetectionReport };