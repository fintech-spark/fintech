import { ValidationError } from '@/lib/errors';
import type { Clock } from '@/lib/clock';
import {
  createMoney,
  type CurrencyCode,
  type DateRange,
  type TenantContext,
} from '@/lib/types';
import { randomUUID } from 'node:crypto';
import {
  chooseBucketGranularity,
  resolveReportingTimezone,
  splitIntoBuckets,
  validatePeriod,
  type HalfOpenPeriod,
} from '@/modules/analytics';
import { createBuckets, distributeDatedItems, projectCashFlow } from '../domain/engine';
import type { CashFlowInputs, CashFlowProjection } from '../domain/types';
import {
  MAX_HISTORY_PERIODS,
  type CashFlowForecastStore,
  type CashFlowRepository,
} from '../infrastructure/cash-flow-repository';
import {
  hydrateForecast,
  toForecastRow,
} from '../infrastructure/cash-flow-serialization';
import type { CashFlowForecast, CashFlowRisk, OpeningBalanceSource } from '../domain/types';
import type { CashFlowService, UpcomingObligations } from './service';

/**
 * Longest horizon a projection may cover.
 *
 * A cash view is a near-term operational tool. Bounding the horizon keeps the
 * bucket count small, keeps every query index-aligned, and stops a caller from
 * requesting a multi-year projection that no source table could support.
 */
export const MAX_HORIZON_DAYS = 400;

/** Default horizon when a caller supplies an open-ended range. */
export const DEFAULT_HORIZON_DAYS = 90;

/** Upper bound on a near-term obligation window. */
export const MAX_OBLIGATION_WINDOW_DAYS = 365;

/**
 * Cash-flow intelligence service.
 *
 * Deliberately thin: it gathers verified, tenant-scoped facts, hands them to the
 * pure engine in `domain/engine.ts`, and persists or returns the result. No
 * financial arithmetic happens in this file, so the service cannot drift from
 * what the domain computes, and the whole projection is testable without it.
 */
export class PostgresCashFlowService implements CashFlowService {
  constructor(
    private readonly repository: CashFlowRepository,
    private readonly store: CashFlowForecastStore,
    private readonly clock: Clock,
  ) {}

  async forecast(ctx: TenantContext, period: DateRange): Promise<CashFlowForecast> {
    const horizon = normaliseHorizon(validatePeriod(period));
    const inputs = await this.gatherInputs(ctx, horizon);
    const buckets = createBuckets(
      splitIntoBuckets(horizon, chooseBucketGranularity(horizon), inputs.timezone),
    );
    distributeDatedItems(buckets, inputs);
    const projection = projectCashFlow({
      buckets,
      inputs,
      openingBalanceMinor: inputs.openingCashMinor,
      openingBalanceSource: inputs.openingBalanceSource,
    });

    const forecast: CashFlowForecast = {
      id: randomUUID(),
      businessId: ctx.businessId,
      period: { from: horizon.from, to: horizon.to },
      periods: projection.periods,
      startingCash: moneyOf(projection.openingBalanceMinor, inputs.currency),
      endingCash: moneyOf(projection.endingCashMinor, inputs.currency),
      risks: projection.risks,
      calculatedAt: this.clock.now(),
      currency: inputs.currency,
      reportingTimezone: inputs.timezone,
      granularity: chooseBucketGranularity(horizon),
      assumptions: projection.assumptions,
      coverage: projection.coverage,
      isProjection: true,
      openingBalanceSource: inputs.openingBalanceSource,
    };

    await this.store.save(toForecastRow({ id: forecast.id, businessId: ctx.businessId, forecast }));
    return forecast;
  }

  async getRisks(ctx: TenantContext): Promise<readonly CashFlowRisk[]> {
    const latest = await this.getLatestForecast(ctx);
    return latest?.risks ?? [];
  }

  async getLatestForecast(ctx: TenantContext): Promise<CashFlowForecast | null> {
    const row = await this.store.findLatest(ctx.businessId);
    return row === null ? null : hydrateForecast(row, this.clock.now());
  }

  async getForecastById(
    ctx: TenantContext,
    forecastId: string,
  ): Promise<CashFlowForecast | null> {
    assertOpaqueId(forecastId, 'forecastId');
    const row = await this.store.findById(ctx.businessId, forecastId);
    return row === null ? null : hydrateForecast(row, this.clock.now());
  }

  /**
   * Near-term obligations without building a full projection.
   *
   * Every figure is an amount with a recorded due date, so nothing here is a
   * forecast beyond the collection assumption itself. That assumption is stated
   * in `coverageNote` rather than hidden.
   */
  async getUpcomingObligations(
    ctx: TenantContext,
    withinDays: number,
  ): Promise<UpcomingObligations> {
    const windowDays = clampWindowDays(withinDays);
    const asOf = this.clock.now();
    const windowEnd = new Date(asOf.getTime() + windowDays * 86_400_000);
    const [receivables, payables, settings] = await Promise.all([
      this.repository.getReceivablesForProjection(ctx.businessId, asOf),
      this.repository.getPayablesForProjection(ctx.businessId, asOf),
      this.repository.getReportingSettings(ctx.businessId),
    ]);

    const inWindowReceivables = receivables.filter((r) => r.dueDate.getTime() < windowEnd.getTime());
    const inWindowPayables = payables.filter((p) => p.dueDate.getTime() < windowEnd.getTime());

    const expectedInflows = sumOf(inWindowReceivables.map((r) => r.openMinor));
    const expectedOutflows = sumOf(inWindowPayables.map((p) => p.openMinor));

    return {
      windowStart: asOf,
      windowEnd,
      expectedInflows,
      expectedOutflows,
      netExpected: expectedInflows - expectedOutflows,
      receivableCount: inWindowReceivables.length,
      payableCount: inWindowPayables.length,
      overdueReceivablesMinor: sumOf(
        receivables.filter((r) => r.daysOverdue > 0).map((r) => r.openMinor),
      ),
      overduePayablesMinor: sumOf(
        payables.filter((p) => p.daysOverdue > 0).map((p) => p.openMinor),
      ),
      currency: settings.currency,
      isProjection: true,
      coverageNote:
        'Amounts are open balances with recorded due dates. They are obligations, not guaranteed movements.',
    };
  }

  /**
   * Gathers every input the engine needs.
   *
   * All reads are tenant-scoped by `ctx.businessId` and bounded by the horizon.
   * The historical read is capped so extrapolation cannot scan a tenant's whole
   * ledger.
   */
  private async gatherInputs(ctx: TenantContext, horizon: HalfOpenPeriod): Promise<CashFlowInputs> {
    const asOf = this.clock.now();
    const settings = await this.repository.getReportingSettings(ctx.businessId);
    const timezone = resolveReportingTimezone(settings.timezone).timeZone;

    const [opening, receivables, payables, datedExpenses, recurring, history] = await Promise.all([
      this.repository.getOpeningCash(ctx.businessId, horizon.from),
      this.repository.getReceivablesForProjection(ctx.businessId, asOf),
      this.repository.getPayablesForProjection(ctx.businessId, asOf),
      this.repository.getDatedExpensesForProjection(ctx.businessId, horizon),
      this.repository.getRecurringExpensesForProjection(ctx.businessId),
      this.repository.getHistoricalInflows(ctx.businessId, horizon.from, MAX_HISTORY_PERIODS),
    ]);

    const openingBalanceSource: OpeningBalanceSource = opening.hasRecords
      ? 'ledger_derived'
      : 'unavailable';

    return {
      businessId: ctx.businessId,
      currency: settings.currency,
      timezone,
      horizon,
      openingCashMinor: opening.cashMinor,
      openingBalanceSource,
      receivables,
      payables,
      datedExpenses,
      recurringExpenses: recurring,
      historicalInflows: history,
      historicalWindowDays: Math.round(
        history.reduce(
          (days, entry) => days + (entry.to.getTime() - entry.from.getTime()) / 86_400_000,
          0,
        ),
      ),
      asOf,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamps a requested horizon to the supported maximum. */
export function normaliseHorizon(period: DateRange): HalfOpenPeriod {
  const days = (period.to.getTime() - period.from.getTime()) / 86_400_000;
  if (days <= 0) {
    throw new ValidationError('The cash-flow horizon must span at least one day.');
  }
  if (days <= MAX_HORIZON_DAYS) return { from: period.from, to: period.to };
  return {
    from: period.from,
    to: new Date(period.from.getTime() + MAX_HORIZON_DAYS * 86_400_000),
  };
}

function clampWindowDays(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_HORIZON_DAYS;
  return Math.min(MAX_OBLIGATION_WINDOW_DAYS, Math.floor(value));
}

function moneyOf(minor: number, currency: string): CashFlowForecast['startingCash'] {
  return createMoney(minor, asCurrencyCode(currency));
}

/** Narrows a stored currency string to the repository's canonical union. */
function asCurrencyCode(value: string): CurrencyCode {
  return value === 'USD' || value === 'EUR' || value === 'GBP' ? value : 'INR';
}

function sumOf(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function assertOpaqueId(value: string, field: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new ValidationError(`${field} must be a non-empty identifier of at most 128 characters.`);
  }
}

export type { CashFlowProjection };