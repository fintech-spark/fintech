import { NotFoundError, ValidationError } from '@/lib/errors';
import { asBusinessId, createMoney, type CurrencyCode, type Money } from '@/lib/types';
import { sumMinorUnits } from '@/modules/analytics';
import type {
  LeakCategory,
  LeakSeverity,
  LeakStatus,
  ProfitLeak,
  SuppressedDetector,
  UnavailableDetector,
} from '../domain/types';
import type { LeakFilterInput, ProfitLeakRepository } from './repository';

/**
 * PostgreSQL store for detected leaks.
 *
 * Reads are tenant-scoped and paginated with a bound limit. Writes use
 * `ON CONFLICT (id) DO UPDATE` so re-running detection over the same period is
 * idempotent: the same deterministic leak id updates the existing row instead of
 * accumulating duplicates.
 */
export class PostgresProfitLeakRepository implements ProfitLeakRepository {
  constructor(private readonly db: {
    query<T>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>;
    execute(sql: string, params?: readonly unknown[]): Promise<number>;
  }) {}

  async findById(businessId: ProfitLeak['businessId'], id: string): Promise<ProfitLeak | null> {
    const rows = await this.db.query<LeakSqlRow>(SELECT_BY_ID_SQL, [businessId, id]);
    return rows[0] === undefined ? null : toDomain(rows[0]);
  }

  async save(leak: ProfitLeak): Promise<ProfitLeak> {
    const affected = await this.db.execute(UPSERT_SQL, [
      leak.id,
      leak.businessId,
      leak.category,
      leak.severity,
      leak.title,
      leak.description,
      leak.impact.amount,
      leak.currency,
      leak.impactPeriod,
      JSON.stringify(leak.evidence),
      leak.status,
      leak.detectedAt,
      leak.resolvedAt ?? null,
      JSON.stringify({
        calculation: leak.calculation,
        suggestedInvestigation: leak.suggestedInvestigation,
        relatedRecordIds: leak.relatedRecordIds,
      }),
    ]);
    if (affected === 0) throw new NotFoundError('Profit leak', leak.id);
    return leak;
  }

  async update(leak: ProfitLeak): Promise<ProfitLeak> {
    const affected = await this.db.execute(UPDATE_SQL, [
      leak.status,
      leak.severity,
      leak.title,
      leak.description,
      leak.impact.amount,
      leak.impactPeriod,
      JSON.stringify(leak.evidence),
      leak.resolvedAt ?? null,
      JSON.stringify({
        calculation: leak.calculation,
        suggestedInvestigation: leak.suggestedInvestigation,
        relatedRecordIds: leak.relatedRecordIds,
      }),
      leak.businessId,
      leak.id,
    ]);
    if (affected === 0) throw new NotFoundError('Profit leak', leak.id);
    return leak;
  }

  async list(businessId: ProfitLeak['businessId'], filters: LeakFilterInput) {
    const where = buildWhereClause(filters);
    const rows = await this.db.query<LeakSqlRow>(SELECT_PAGE_SQL, [
      businessId,
      where.category,
      where.severity,
      where.status,
      filters.limit,
      (filters.page - 1) * filters.limit,
    ]);
    const total = await this.countMatching(businessId, where);
    const items = rows.map(toDomain);

    return {
      items,
      total,
      page: filters.page,
      limit: filters.limit,
      hasMore: filters.page * filters.limit < total,
    };
  }

  async findActiveByCategory(
    businessId: ProfitLeak['businessId'],
    category: LeakCategory,
  ): Promise<readonly ProfitLeak[]> {
    const rows = await this.db.query<LeakSqlRow>(SELECT_BY_CATEGORY_SQL, [businessId, category, ACTIVE_LEAKS_PER_CATEGORY]);
    return rows.map(toDomain);
  }

  async sumActiveImpact(businessId: ProfitLeak['businessId']) {
    const rows = await this.db.query<{ total_minor: number; leak_count: number }>(SUM_ACTIVE_SQL, [
      businessId,
    ]);
    return { totalMinor: rows[0]?.total_minor ?? 0, leakCount: rows[0]?.leak_count ?? 0 };
  }

  /**
   * Tenant-scoped status change.
   *
   * Guarded on both the id and the tenant so a caller cannot dismiss another
   * merchant's leak, and returns the updated row so the caller can see what
   * actually changed rather than assuming the write landed.
   */
  async updateStatus(
    businessId: ProfitLeak['businessId'],
    id: string,
    status: LeakStatus,
  ): Promise<ProfitLeak> {
    const affected = await this.db.execute(UPDATE_STATUS_SQL, [status, status === 'resolved' ? new Date() : null, businessId, id]);
    if (affected === 0) {
      throw new NotFoundError('Profit leak', id);
    }
    const updated = await this.findById(businessId, id);
    if (updated === null) throw new NotFoundError('Profit leak', id);
    return updated;
  }

  private async countMatching(
    businessId: ProfitLeak['businessId'],
    where: { category: string | null; severity: string | null; status: string | null },
  ): Promise<number> {
    const rows = await this.db.query<{ total: number }>(COUNT_SQL, [
      businessId,
      where.category,
      where.severity,
      where.status,
    ]);
    return rows[0]?.total ?? 0;
  }
}

/**
 * Filter-to-placeholder resolution.
 *
 * Values become bound parameters; only the presence of a filter changes the SQL
 * shape, and it does so through fixed template fragments. Nothing derived from a
 * caller is ever concatenated into the statement.
 */
function buildWhereClause(filters: {
  category?: LeakCategory;
  severity?: LeakSeverity;
  status?: LeakStatus;
}): { category: string | null; severity: string | null; status: string | null } {
  return {
    category: filters.category ?? null,
    severity: filters.severity ?? null,
    status: filters.status ?? null,
  };
}

interface LeakSqlRow {
  readonly id: string;
  readonly business_id: string;
  readonly category: string;
  readonly severity: string;
  readonly title: string;
  readonly description: string;
  readonly impact_minor: number;
  readonly currency: string;
  readonly impact_period: string;
  readonly evidence: unknown;
  readonly status: string;
  readonly detected_at: Date;
  readonly resolved_at: Date | null;
  readonly detail: unknown;
}

function toDomain(row: LeakSqlRow): ProfitLeak {
  const detail = asDetail(row.detail);
  return {
    id: row.id,
    businessId: asBusinessId(row.business_id),
    category: row.category as LeakCategory,
    severity: row.severity as LeakSeverity,
    title: row.title,
    description: row.description,
    impact: createMoney(row.impact_minor, asCurrency(row.currency)),
    impactPeriod: row.impact_period,
    evidence: asEvidence(row.evidence),
    status: row.status as LeakStatus,
    detectedAt: row.detected_at,
    ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at }),
    currency: row.currency,
    calculation: detail.calculation,
    suggestedInvestigation: detail.suggestedInvestigation,
    relatedRecordIds: detail.relatedRecordIds,
  };
}

interface LeakDetail {
  readonly calculation: ProfitLeak['calculation'];
  readonly suggestedInvestigation: string;
  readonly relatedRecordIds: readonly string[];
}

/**
 * Reconstructs the detail stored alongside a leak.
 *
 * Rows written before this detail existed fall back to explicit placeholders
 * rather than throwing, so an older leak stays readable instead of breaking a
 * merchant's dashboard.
 */
function asDetail(value: unknown): LeakDetail {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const calculation = record.calculation;
  return {
    calculation:
      typeof calculation === 'object' && calculation !== null
        ? (calculation as ProfitLeak['calculation'])
        : {
            rule: 'dead_inventory',
            ruleDescription: 'Not recorded for this leak.',
            formula: 'Not recorded for this leak.',
            inputs: {},
            observedValue: 0,
            baselineValue: 0,
            deviation: 0,
            deviationUnit: 'minor_units',
            periodStart: new Date(0),
            periodEnd: new Date(0),
            comparisonPeriodStart: new Date(0),
            comparisonPeriodEnd: new Date(0),
            currency: 'INR',
          },
    suggestedInvestigation:
      typeof record.suggestedInvestigation === 'string'
        ? record.suggestedInvestigation
        : 'No investigation recorded for this leak.',
    relatedRecordIds: Array.isArray(record.relatedRecordIds)
      ? record.relatedRecordIds.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

function asEvidence(value: unknown): ProfitLeak['evidence'] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is ProfitLeak['evidence'][number] =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { resourceId?: unknown }).resourceId === 'string',
  );
}

function asCurrency(value: string): CurrencyCode {
  return value === 'USD' || value === 'EUR' || value === 'GBP' ? value : 'INR';
}

/** Validates a caller-supplied status transition. */
export function assertLeakStatus(value: string): LeakStatus {
  const allowed: LeakStatus[] = ['active', 'acknowledged', 'resolved', 'dismissed'];
  if (!(allowed as string[]).includes(value)) {
    throw new ValidationError(`Unsupported profit leak status "${value}".`);
  }
  return value as LeakStatus;
}

/** Deterministic dedupe key, exported so a caller can check for an existing leak. */
export function leakDedupeKey(
  businessId: ProfitLeak['businessId'],
  category: LeakCategory,
  periodStart: Date,
  periodEnd: Date,
  impactMinor: number,
): string {
  return [businessId, category, periodStart.toISOString(), periodEnd.toISOString(), impactMinor].join(':');
}

export type { Money, SuppressedDetector, UnavailableDetector };

const SELECT_COLUMNS = `
  id, business_id, category, severity, title, description, impact_minor,
  currency, impact_period, evidence, status, detected_at, resolved_at, detail
`;

const SELECT_BY_ID_SQL = `SELECT ${SELECT_COLUMNS} FROM profit_leaks WHERE business_id = $1 AND id = $2 LIMIT 1`;

const SELECT_PAGE_SQL = `
SELECT ${SELECT_COLUMNS}
FROM profit_leaks
WHERE business_id = $1
  AND ($2::text IS NULL OR category = $2)
  AND ($3::text IS NULL OR severity = $3)
  AND ($4::text IS NULL OR status = $4)
ORDER BY severity ASC, impact_minor DESC, detected_at DESC, id ASC
LIMIT $5 OFFSET $6
`;

const SELECT_BY_CATEGORY_SQL = `
SELECT ${SELECT_COLUMNS}
FROM profit_leaks
WHERE business_id = $1 AND category = $2 AND status IN ('active', 'acknowledged')
ORDER BY impact_minor DESC, detected_at DESC
LIMIT $3
`;

/** Bound on a single category's active-leak read. */
export const ACTIVE_LEAKS_PER_CATEGORY = 200;

const COUNT_SQL = `
SELECT COUNT(*)::int AS total
FROM profit_leaks
WHERE business_id = $1
  AND ($2::text IS NULL OR category = $2)
  AND ($3::text IS NULL OR severity = $3)
  AND ($4::text IS NULL OR status = $4)
`;

const SUM_ACTIVE_SQL = `
SELECT COALESCE(SUM(impact_minor), 0)::bigint AS total_minor,
       COUNT(*)::int                      AS leak_count
FROM profit_leaks
WHERE business_id = $1 AND status IN ('active', 'acknowledged')
`;

const UPSERT_SQL = `
INSERT INTO profit_leaks (
  id, business_id, category, severity, title, description, impact_minor,
  currency, impact_period, evidence, status, detected_at, resolved_at, detail
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14::jsonb)
ON CONFLICT (id) DO UPDATE SET
  severity = EXCLUDED.severity,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  impact_minor = EXCLUDED.impact_minor,
  impact_period = EXCLUDED.impact_period,
  evidence = EXCLUDED.evidence,
  detected_at = EXCLUDED.detected_at,
   detail = EXCLUDED.detail
WHERE profit_leaks.business_id = EXCLUDED.business_id
`;

const UPDATE_SQL = `
UPDATE profit_leaks
SET status = $1,
    severity = $2,
    title = $3,
    description = $4,
    impact_minor = $5,
    impact_period = $6,
    evidence = $7::jsonb,
    resolved_at = $8,
    detail = $9::jsonb,
    updated_at = now()
WHERE business_id = $10 AND id = $11
`;

const UPDATE_STATUS_SQL = `
UPDATE profit_leaks
SET status = $1,
    resolved_at = COALESCE($2, resolved_at),
    updated_at = now()
WHERE business_id = $3 AND id = $4
`;

/** Total impact of a set of leaks, used by the service. */
export function totalImpact(leaks: readonly ProfitLeak[]): number {
  return sumMinorUnits(leaks.map((leak) => leak.impact.amount));
}
