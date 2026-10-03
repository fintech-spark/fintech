import type { BusinessId } from '@/lib/types';
import type { HalfOpenPeriod } from '@/modules/analytics';
import type {
  DatedExpenseInput,
  HistoricalPeriodInput,
  ObligationInput,
  RecurringExpenseInput,
  RecurringFrequency,
} from '../domain/types';

/**
 * Read model for cash-flow intelligence.
 *
 * Read-only by design: a projection must not be able to change a receivable, a
 * payable or an expense. Every method is tenant-scoped by an explicit
 * `businessId` and bounded by an explicit period, so no query can grow without a
 * limit chosen here rather than by the caller.
 */
export interface CashFlowRepository {
  /** Reporting currency and timezone, which drive bucketing and labels. */
  getReportingSettings(
    businessId: BusinessId,
  ): Promise<{ currency: string; timezone: string }>;

  /** Ledger-derived cash immediately before the horizon. */
  getOpeningCash(
    businessId: BusinessId,
    horizonStart: Date,
  ): Promise<{ cashMinor: number; hasRecords: boolean }>;

  /** Open receivables with counterparty names, for collection projection. */
  getReceivablesForProjection(
    businessId: BusinessId,
    asOf: Date,
  ): Promise<readonly ObligationInput[]>;

  /** Open payables with counterparty names, for payment projection. */
  getPayablesForProjection(
    businessId: BusinessId,
    asOf: Date,
  ): Promise<readonly ObligationInput[]>;

  /** Recognised non-recurring expenses already dated in the horizon. */
  getDatedExpensesForProjection(
    businessId: BusinessId,
    horizon: HalfOpenPeriod,
  ): Promise<readonly DatedExpenseInput[]>;

  /** Recurring expenses with a known next due date. */
  getRecurringExpensesForProjection(
    businessId: BusinessId,
  ): Promise<readonly RecurringExpenseInput[]>;

  /**
   * Recognised inflow per historical period, newest `limit` periods, for the
   * bounded sales extrapolation. `limit` is applied in SQL.
   */
  getHistoricalInflows(
    businessId: BusinessId,
    before: Date,
    limit: number,
  ): Promise<readonly HistoricalPeriodInput[]>;
}

/** Shape of the `cash_flow_forecasts` row this module persists. */
export interface CashFlowForecastRow {
  readonly id: string;
  readonly businessId: BusinessId;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly periods: unknown;
  readonly startingCashMinor: number;
  readonly endingCashMinor: number;
  readonly currency: string;
  readonly risks: unknown;
  readonly calculatedAt: Date;
}

/** Persistence for computed forecasts, so a merchant's last view can be reopened. */
export interface CashFlowForecastStore {
  save(forecast: CashFlowForecastRow): Promise<CashFlowForecastRow>;
  findLatest(businessId: BusinessId): Promise<CashFlowForecastRow | null>;
  findById(businessId: BusinessId, id: string): Promise<CashFlowForecastRow | null>;
}

/** Upper bound on historical periods read for extrapolation. */
export const MAX_HISTORY_PERIODS = 12;

/** Default horizon when a caller does not state one. */
export const DEFAULT_HORIZON_DAYS = 30;

/** Frequency strings the `expenses` CHECK constraint permits. */
export const RECURRING_FREQUENCIES: readonly RecurringFrequency[] = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
];

export function asRecurringFrequency(value: string): RecurringFrequency {
  return (RECURRING_FREQUENCIES as readonly string[]).includes(value)
    ? (value as RecurringFrequency)
    : 'monthly';
}