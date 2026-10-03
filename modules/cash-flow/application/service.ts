import type { TenantContext, DateRange } from '@/lib/types';
import type { CashFlowForecast, CashFlowRisk } from '../domain/types';

/**
 * Application contract for cash-flow intelligence.
 *
 * Every method returns a projection that is explicitly labelled as one: the
 * result carries `isProjection`, its `assumptions`, and its `coverage`. A caller
 * cannot accidentally treat a forecast as an observed balance.
 */
export interface CashFlowService {
  /**
   * Build a projection for the requested horizon.
   * The horizon is clamped to `MAX_HORIZON_DAYS`; the result's `period` reports
   * the horizon actually used.
   */
  forecast(ctx: TenantContext, period: DateRange): Promise<CashFlowForecast>;

  /** Risks from the most recent stored projection. Empty when none exists. */
  getRisks(ctx: TenantContext): Promise<readonly CashFlowRisk[]>;

  /** The most recent stored projection, or `null` when none has been computed. */
  getLatestForecast(ctx: TenantContext): Promise<CashFlowForecast | null>;

  /** One stored projection, tenant-scoped. `null` when absent or another tenant's. */
  getForecastById(ctx: TenantContext, forecastId: string): Promise<CashFlowForecast | null>;

  /**
   * Near-term obligations only, without building a full projection.
   * Cheaper than `forecast` for a merchant-facing "what is due" list.
   */
  getUpcomingObligations(
    ctx: TenantContext,
    withinDays: number,
  ): Promise<UpcomingObligations>;
}

/** Amounts owed to and by the merchant inside a near-term window. */
export interface UpcomingObligations {
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly expectedInflows: number;
  readonly expectedOutflows: number;
  readonly netExpected: number;
  readonly receivableCount: number;
  readonly payableCount: number;
  readonly overdueReceivablesMinor: number;
  readonly overduePayablesMinor: number;
  readonly currency: string;
  readonly isProjection: true;
  readonly coverageNote: string;
}

export type { CashFlowForecast, CashFlowRisk };