import type { BusinessId, TenantContext } from '@/lib/types';
import { NotFoundError, ValidationError } from '@/lib/errors';
import type { CashFlowForecastRow } from '../infrastructure/cash-flow-repository';
import type { CashFlowForecast } from '../domain/types';
import { randomUUID } from 'node:crypto';

/**
 * PostgreSQL store for computed projections.
 *
 * A projection is a record of what was calculated and when, so a merchant can
 * reopen yesterday's cash view and see it did not silently change. It is not an
 * executed state: nothing here mutates a receivable, a payable or an expense.
 */
export class PostgresCashFlowForecastStore {
  constructor(private readonly db: {
    query<T>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>;
    execute(sql: string, params?: readonly unknown[]): Promise<number>;
  }) {}

  async save(forecast: CashFlowForecastRow): Promise<CashFlowForecastRow> {
    await this.db.execute(INSERT_SQL, [
      forecast.id,
      forecast.businessId,
      forecast.periodStart,
      forecast.periodEnd,
      JSON.stringify(forecast.periods),
      forecast.startingCashMinor,
      forecast.endingCashMinor,
      forecast.currency,
      JSON.stringify(forecast.risks),
      forecast.calculatedAt,
    ]);
    return forecast;
  }

  async findLatest(businessId: BusinessId): Promise<CashFlowForecastRow | null> {
    const rows = await this.db.query<ForecastSqlRow>(LATEST_SQL, [businessId]);
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  async findById(businessId: BusinessId, id: string): Promise<CashFlowForecastRow | null> {
    const rows = await this.db.query<ForecastSqlRow>(BY_ID_SQL, [businessId, id]);
    return rows[0] === undefined ? null : toRow(rows[0]);
  }
}

/** Assigns a stable id to a projection and persists it. */
export function withGeneratedId(forecast: CashFlowForecast): CashFlowForecast {
  return { ...forecast, id: randomUUID() };
}

function toRow(row: ForecastSqlRow): CashFlowForecastRow {
  return {
    id: row.id,
    businessId: row.business_id as CashFlowForecastRow['businessId'],
    periodStart: row.period_start,
    periodEnd: row.period_end,
    periods: row.periods,
    startingCashMinor: row.starting_cash_minor,
    endingCashMinor: row.ending_cash_minor,
    currency: row.currency,
    risks: row.risks,
    calculatedAt: row.calculated_at,
  };
}

interface ForecastSqlRow {
  readonly id: string;
  readonly business_id: string;
  readonly period_start: Date;
  readonly period_end: Date;
  readonly periods: unknown;
  readonly starting_cash_minor: number;
  readonly ending_cash_minor: number;
  readonly currency: string;
  readonly risks: unknown;
  readonly calculated_at: Date;
}

const INSERT_SQL = `
INSERT INTO cash_flow_forecasts (
  id, business_id, period_start, period_end, periods,
  starting_cash_minor, ending_cash_minor, currency, risks, calculated_at
)
VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10)
ON CONFLICT (id) DO NOTHING
`;

const LATEST_SQL = `
SELECT id, business_id, period_start, period_end, periods,
       starting_cash_minor, ending_cash_minor, currency, risks, calculated_at
FROM cash_flow_forecasts
WHERE business_id = $1
ORDER BY calculated_at DESC, id DESC
LIMIT 1
`;

const BY_ID_SQL = `
SELECT id, business_id, period_start, period_end, periods,
       starting_cash_minor, ending_cash_minor, currency, risks, calculated_at
FROM cash_flow_forecasts
WHERE business_id = $1 AND id = $2
LIMIT 1
`;

/**
 * Tenant-scoped existence check used before a projection is shown as current.
 * Throws rather than returning `false` so a caller cannot mistake an
 * authorization failure for an absent record.
 */
export async function assertOwnedByTenant(
  store: { findById(businessId: BusinessId, id: string): Promise<CashFlowForecastRow | null> },
  ctx: TenantContext,
  forecastId: string,
): Promise<CashFlowForecastRow> {
  const row = await store.findById(ctx.businessId, forecastId);
  if (row === null) {
    throw new NotFoundError('Cash-flow forecast', forecastId);
  }
  return row;
}

export function assertValidForecastId(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new ValidationError('forecastId must be a non-empty identifier of at most 128 characters.');
  }
}