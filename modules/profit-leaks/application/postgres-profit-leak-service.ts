import { NotFoundError, ValidationError } from '@/lib/errors';
import type { Clock } from '@/lib/clock';
import type { PaginatedResult, PaginationParams, TenantContext } from '@/lib/types';
import type { DataQuality, FinancialSnapshot, HalfOpenPeriod } from '@/modules/analytics';
import { previousEquivalentPeriod, validatePeriod } from '@/modules/analytics';
import type { AnalyticsService } from '@/modules/analytics';
import { eventBus } from '@/lib/events';
import type {
  LeakCategory,
  LeakDetectionReport,
  LeakSeverity,
  LeakStatus,
  ProfitLeak,
  SuppressedDetector,
  UnavailableDetector,
} from '../domain/types';
import { DETECTORS, UNAVAILABLE_DETECTORS } from '../domain/detectors';
import { totalImpactMinor } from '../domain/rules';
import type { LeakFilterInput, ProfitLeakRepository } from '../infrastructure/repository';
import { assertLeakStatus } from '../infrastructure/postgres-profit-leak-repository';

/** Filters accepted by the leak list endpoint. */
export interface LeakFilters extends PaginationParams {
  readonly category?: LeakCategory;
  readonly severity?: LeakSeverity;
  readonly status?: LeakStatus;
}

/**
 * Application contract for the profit-leak engine.
 *
 * `detectLeaks` returns the leaks alone, for simple consumers.
 * `analyze` returns the full report including suppressed detectors, which is what
 * an AI tool or a "why am I seeing this?" panel needs in order to explain an
 * absence as well as a presence.
 */
export interface ProfitLeakService {
  /** Run every detector and return only the leaks that fired. */
  detectLeaks(ctx: TenantContext, period: { from: Date; to: Date }): Promise<readonly ProfitLeak[]>;

  /** Run every detector and return the full report, persist included leaks. */
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

/**
 * Profit-leak detection service.
 *
 * Reads through the analytics service rather than its own SQL, so every leak is
 * computed from the same authoritative snapshots the merchant dashboard shows.
 * A leak that disagreed with the dashboard would be worse than no leak.
 */
export class PostgresProfitLeakService implements ProfitLeakService {
  constructor(
    private readonly repository: ProfitLeakRepository,
    private readonly analytics: AnalyticsService,
    private readonly clock: Clock,
    private readonly publisher = eventBus,
  ) {}

  async detectLeaks(ctx: TenantContext, period: { from: Date; to: Date }) {
    const report = await this.analyze(ctx, period);
    return report.detected;
  }

  async analyze(ctx: TenantContext, period: { from: Date; to: Date }): Promise<LeakDetectionReport> {
    const validated = validatePeriod(period);
    const current = await this.analytics.getSnapshot(ctx, validated);
    const previousPeriod = previousEquivalentPeriod(toHalfOpen(validated));
    const previous = await this.analytics.getSnapshot(ctx, toDateRange(previousPeriod));
    const evidence = await this.gatherEvidence(
      ctx,
      current,
      previous,
      validated,
      previousPeriod,
    );

    const context = {
      businessId: ctx.businessId,
      currency: current.currency,
      current,
      previous,
      period: toHalfOpen(validated),
      previousPeriod,
      detectedAt: this.clock.now(),
      ...evidence,
    };

    const suppressed: SuppressedDetector[] = [];
    const detected: ProfitLeak[] = [];

    for (const detector of DETECTORS) {
      const result = detector.detect(context);
      if (result.fired) {
        detected.push(result.leak);
      } else {
        suppressed.push(result.suppressed);
      }
    }

    const persisted = await this.persist(detected);
    await this.publish(persisted);

    return {
      businessId: ctx.businessId,
      detected: persisted,
      suppressed,
      detectorsRun: DETECTORS.map((detector) => detector.category),
      detectorsUnavailable: [...UNAVAILABLE_DETECTORS],
      quality: resolveQuality(current.quality, persisted.length),
      calculatedAt: this.clock.now(),
      periodStart: validated.from,
      periodEnd: validated.to,
      currency: current.currency,
      totalImpactMinor: totalImpactMinor(persisted),
    };
  }

  async list(ctx: TenantContext, filters: LeakFilters): Promise<PaginatedResult<ProfitLeak>> {
    const input: LeakFilterInput = {
      category: filters.category,
      severity: filters.severity,
      status: filters.status,
      page: normalisePage(filters.page),
      limit: normaliseLimit(filters.limit),
    };
    return this.repository.list(ctx.businessId, input);
  }

  async getById(ctx: TenantContext, leakId: string): Promise<ProfitLeak | null> {
    assertOpaqueId(leakId, 'leakId');
    return this.repository.findById(ctx.businessId, leakId);
  }

  async getTotalImpact(ctx: TenantContext) {
    const impact = await this.repository.sumActiveImpact(ctx.businessId);
    return { total: impact.totalMinor, leakCount: impact.leakCount };
  }

  async updateStatus(
    ctx: TenantContext,
    leakId: string,
    status: LeakStatus,
  ): Promise<ProfitLeak> {
    assertOpaqueId(leakId, 'leakId');
    const target = assertLeakStatus(status);
    const existing = await this.repository.findById(ctx.businessId, leakId);
    if (existing === null) {
      throw new NotFoundError('Profit leak', leakId);
    }
    const repository = this.repository as unknown as {
      updateStatus?: (
        businessId: ProfitLeak['businessId'],
        id: string,
        next: LeakStatus,
      ) => Promise<ProfitLeak>;
    };
    if (typeof repository.updateStatus === 'function') {
      return repository.updateStatus(ctx.businessId, leakId, target);
    }
    return this.repository.update({ ...existing, status: target });
  }

  /**
   * Persists newly detected leaks.
   *
   * Leak ids are deterministic, so re-running detection over an unchanged period
   * updates the same rows instead of creating duplicates.
   */
  private async persist(leaks: readonly ProfitLeak[]): Promise<ProfitLeak[]> {
    const stored: ProfitLeak[] = [];
    for (const leak of leaks) {
      stored.push(await this.repository.save(leak));
    }
    return stored;
  }

  /**
   * Publishes one event per leak.
   *
   * Publishing through the shared event bus keeps notification delivery out of
   * this module: cash-flow and the notifications module subscribe, so neither has
   * to depend on the other.
   */
  private async publish(leaks: readonly ProfitLeak[]): Promise<void> {
    for (const leak of leaks) {
      await this.publisher.publish({
        id: `leak-${leak.id}`,
        type: 'profit_leak.detected',
        businessId: leak.businessId,
        timestamp: leak.detectedAt,
        correlationId: `leak-${leak.id}`,
        payload: {
          leakId: leak.id,
          category: leak.category,
          estimatedLossMinorUnits: leak.impact.amount,
          severity: leak.severity,
        },
      });
    }
  }

  /**
   * Gathers everything the detectors need that the snapshot does not carry.
   *
   * `productSales` and `purchasePrices` cover the current and baseline windows;
   * `productsWithRecentSales` is the trailing window used for dead stock.
   */
  private async gatherEvidence(
    ctx: TenantContext,
    current: FinancialSnapshot,
    previous: FinancialSnapshot,
    period: { from: Date; to: Date },
    previousPeriod: HalfOpenPeriod,
  ) {
    const [overdue, productSales, purchasePrices, previousPurchasePrices, products, recentSales] =
      await Promise.all([
        this.analytics.getOverdueReceivables(ctx, this.clock.now()),
        this.analytics.getProductSales(ctx, period),
        this.analytics.getPurchasePrices(ctx, period),
        this.analytics.getPurchasePrices(ctx, toDateRange(previousPeriod)),
        this.analytics.getProducts(ctx),
        this.analytics.getRecentlySoldProductIds(ctx, this.clock.now()),
      ]);

    return {
      overdueReceivables: overdue,
      productSales,
      purchasePrices,
      previousPurchasePrices,
      products,
      productsWithRecentSales: recentSales,
      expensesByCategory: toCategoryMap(current),
      previousExpensesByCategory: toCategoryMap(previous),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Expense category totals from a snapshot, keyed by the schema's category names. */
function toCategoryMap(snapshot: FinancialSnapshot): Map<string, number> {
  const merged = new Map<string, number>();
  for (const entry of snapshot.expenseBreakdown) {
    merged.set(entry.category, (merged.get(entry.category) ?? 0) + entry.amountMinor);
  }
  return merged;
}

function resolveQuality(base: DataQuality, leakCount: number): DataQuality {
  if (base === 'insufficient_data') return 'insufficient_data';
  return leakCount > 0 ? base : base === 'partial' ? 'partial' : 'complete';
}

function normalisePage(page?: number): number {
  return typeof page === 'number' && Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
}

function normaliseLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(100, Math.floor(limit));
}

function assertOpaqueId(value: string, field: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new ValidationError(`${field} must be a non-empty identifier of at most 128 characters.`);
  }
}

function toHalfOpen(period: { from: Date; to: Date }): HalfOpenPeriod {
  return { from: period.from, to: period.to };
}

function toDateRange(period: HalfOpenPeriod): { from: Date; to: Date } {
  return { from: period.from, to: period.to };
}

export type { UnavailableDetector };