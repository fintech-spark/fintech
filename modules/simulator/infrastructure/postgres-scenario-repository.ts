import { ValidationError } from '@/lib/errors';
import { asBusinessId, type PaginatedResult } from '@/lib/types';
import type {
  Scenario,
  ScenarioCashTiming,
  ScenarioComparison,
  ScenarioParameter,
  ScenarioSnapshot,
  ScenarioStatus,
} from '../domain/types';
import type { ScenarioRepository } from '../application/postgres-simulator-service';

/**
 * PostgreSQL store for simulated scenarios.
 *
 * The `scenarios` table holds only the hypothetical result: parameters, baseline,
 * projection and comparison. There is no column and no code path here that can
 * write to `products`, `transactions`, `inventory_movements` or `payments`, so a
 * simulation is incapable of mutating production state.
 */
export class PostgresScenarioRepository implements ScenarioRepository {
  constructor(private readonly db: {
    query<T>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>;
    execute(sql: string, params?: readonly unknown[]): Promise<number>;
  }) {}

  async save(scenario: Scenario): Promise<Scenario> {
    await this.db.execute(INSERT_SQL, [
      scenario.id,
      scenario.businessId,
      scenario.name,
      scenario.description ?? null,
      JSON.stringify(scenario.parameters),
      JSON.stringify(scenario.baseline),
      JSON.stringify(scenario.projected),
      JSON.stringify(scenario.comparison),
      scenario.status,
      JSON.stringify({
        currency: scenario.currency,
        periodStart: scenario.periodStart,
        periodEnd: scenario.periodEnd,
        assumptions: scenario.assumptions,
        rejections: scenario.rejections,
        quality: scenario.quality,
        isProjection: scenario.isProjection,
        cashTiming: scenario.cashTiming,
      }),
      scenario.createdAt,
    ]);
    return scenario;
  }

  async findById(businessId: Scenario['businessId'], id: string): Promise<Scenario | null> {
    const rows = await this.db.query<ScenarioSqlRow>(SELECT_BY_ID_SQL, [businessId, id]);
    return rows[0] === undefined ? null : toDomain(rows[0]);
  }

  async list(
    businessId: Scenario['businessId'],
    filters: { page: number; limit: number; status?: ScenarioStatus },
  ): Promise<PaginatedResult<Scenario>> {
    const rows = await this.db.query<ScenarioSqlRow>(SELECT_PAGE_SQL, [
      businessId,
      filters.status ?? null,
      filters.limit,
      (filters.page - 1) * filters.limit,
    ]);
    const total = await this.count(businessId, filters.status);
    return {
      items: rows.map(toDomain),
      total,
      page: filters.page,
      limit: filters.limit,
      hasMore: filters.page * filters.limit < total,
    };
  }

  private async count(businessId: Scenario['businessId'], status?: ScenarioStatus): Promise<number> {
    const rows = await this.db.query<{ total: number }>(COUNT_SQL, [
      businessId,
      status ?? null,
    ]);
    return rows[0]?.total ?? 0;
  }
}

interface ScenarioSqlRow {
  readonly id: string;
  readonly business_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly parameters: unknown;
  readonly baseline: unknown;
  readonly projected: unknown;
  readonly comparison: unknown;
  readonly status: string;
  readonly detail: unknown;
  readonly created_at: Date;
}

/**
 * Rehydrates a stored scenario.
 *
 * Every field is validated and rebuilt explicitly. A row written before a field
 * existed falls back to an explicit placeholder rather than throwing, so an older
 * scenario stays readable and states that its metadata is unavailable.
 */
function toDomain(row: ScenarioSqlRow): Scenario {
  const detail = asDetail(row.detail);
  return {
    id: row.id,
    businessId: asBusinessId(row.business_id),
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    parameters: asParameters(row.parameters),
    baseline: asSnapshot(row.baseline),
    projected: asSnapshot(row.projected),
    comparison: asComparison(row.comparison),
    status: asStatus(row.status),
    createdAt: row.created_at,
    currency: detail.currency,
    periodStart: detail.periodStart,
    periodEnd: detail.periodEnd,
    assumptions: detail.assumptions,
    rejections: detail.rejections,
    quality: detail.quality,
    isProjection: true,
    cashTiming: detail.cashTiming,
  };
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`Stored scenario field "${field}" is not an object.`);
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`Stored scenario field "${field}" is not a finite number.`);
  }
  return value;
}

const ZERO_SNAPSHOT: ScenarioSnapshot = {
  revenue: 0,
  cogs: 0,
  grossProfit: 0,
  grossMarginBps: 0,
  operatingExpenses: 0,
  netProfit: 0,
  netMarginBps: 0,
  grossRevenue: 0,
  discounts: 0,
  quantitySold: 0,
  saleCount: 0,
};

function asSnapshot(value: unknown): ScenarioSnapshot {
  if (value === undefined || value === null) return { ...ZERO_SNAPSHOT };
  const record = asRecord(value, 'snapshot');
  return {
    revenue: asNumber(record.revenue, 'snapshot.revenue'),
    cogs: asNumber(record.cogs, 'snapshot.cogs'),
    grossProfit: asNumber(record.grossProfit, 'snapshot.grossProfit'),
    grossMarginBps: asNumber(record.grossMarginBps, 'snapshot.grossMarginBps'),
    operatingExpenses: asNumber(record.operatingExpenses, 'snapshot.operatingExpenses'),
    netProfit: asNumber(record.netProfit, 'snapshot.netProfit'),
    netMarginBps: asNumber(record.netMarginBps, 'snapshot.netMarginBps'),
    grossRevenue: asNumber(record.grossRevenue ?? record.revenue, 'snapshot.grossRevenue'),
    discounts: asNumber(record.discounts ?? 0, 'snapshot.discounts'),
    quantitySold: asNumber(record.quantitySold ?? 0, 'snapshot.quantitySold'),
    saleCount: asNumber(record.saleCount ?? 0, 'snapshot.saleCount'),
  };
}

function asComparison(value: unknown): ScenarioComparison {
  const record = asRecord(value, 'comparison');
  const direction = record.direction;
  return {
    revenueDelta: asNumber(record.revenueDelta ?? 0, 'comparison.revenueDelta'),
    grossProfitDelta: asNumber(record.grossProfitDelta ?? 0, 'comparison.grossProfitDelta'),
    profitDelta: asNumber(record.profitDelta, 'comparison.profitDelta'),
    marginDeltaBps: asNumber(record.marginDeltaBps ?? 0, 'comparison.marginDeltaBps'),
    adverse: record.adverse === true,
    direction:
      direction === 'increase' || direction === 'decrease' || direction === 'no_change'
        ? direction
        : 'unavailable',
    summary: typeof record.summary === 'string' ? record.summary : 'No comparison recorded.',
  };
}

function asParameters(value: unknown): ScenarioParameter[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is ScenarioParameter =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { type?: unknown }).type === 'string' &&
      typeof (entry as { unit?: unknown }).unit === 'string',
  );
}

function asStatus(value: string): ScenarioStatus {
  return value === 'calculated' || value === 'expired' ? value : 'draft';
}

interface ScenarioDetail {
  readonly currency: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly assumptions: Scenario['assumptions'];
  readonly rejections: Scenario['rejections'];
  readonly quality: Scenario['quality'];
  readonly cashTiming: ScenarioCashTiming;
}

function asDetail(value: unknown): ScenarioDetail {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const quality = record.quality;
  const cashTiming =
    typeof record.cashTiming === 'object' && record.cashTiming !== null
      ? (record.cashTiming as ScenarioCashTiming)
      : {
          upfrontOutlayMinor: 0,
          netCashDeltaMinor: 0,
          affectsProfitAndLoss: false,
        };
  return {
    currency: typeof record.currency === 'string' ? record.currency : 'INR',
    periodStart: asOptionalDate(record.periodStart),
    periodEnd: asOptionalDate(record.periodEnd),
    assumptions: Array.isArray(record.assumptions) ? (record.assumptions as Scenario['assumptions']) : [],
    rejections: Array.isArray(record.rejections) ? (record.rejections as Scenario['rejections']) : [],
    quality:
      quality === 'complete' || quality === 'partial' ? quality : 'insufficient_data',
    cashTiming,
  };
}

function asOptionalDate(value: unknown): Date {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

const SELECT_COLUMNS = `
  id, business_id, name, description, parameters, baseline, projected,
  comparison, status, detail, created_at
`;

const INSERT_SQL = `
INSERT INTO scenarios (id, business_id, name, description, parameters, baseline, projected, comparison, status, detail, created_at)
VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10::jsonb, $11)
ON CONFLICT (id) DO NOTHING
`;

const SELECT_BY_ID_SQL = `SELECT ${SELECT_COLUMNS} FROM scenarios WHERE business_id = $1 AND id = $2 LIMIT 1`;

const SELECT_PAGE_SQL = `
SELECT ${SELECT_COLUMNS}
FROM scenarios
WHERE business_id = $1
  AND ($2::text IS NULL OR status = $2)
ORDER BY created_at DESC, id ASC
LIMIT $3 OFFSET $4
`;

const COUNT_SQL = `
SELECT COUNT(*)::int AS total
FROM scenarios
WHERE business_id = $1 AND ($2::text IS NULL OR status = $2)
`;