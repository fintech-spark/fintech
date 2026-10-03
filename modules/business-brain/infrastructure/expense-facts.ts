// Merchant Brain: expense and financial-risk facts
//
// Expenses aggregate by category and currency. Cash-flow forecasts and profit
// leaks are read from the tables the deterministic services write, so the AI
// sees exactly what a route would show — the model never recomputes a
// projection it was not given.

import 'server-only';

import type { BusinessId, CurrencyCode } from '@/lib/types';
import type { DatabaseClient } from '@/lib/database/client';
import { tenantQuery } from './tenant-query';

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export interface ExpenseCategoryTotal {
  readonly category: string;
  readonly currency: CurrencyCode;
  readonly totalMinor: number;
  readonly entryCount: number;
}

interface ExpenseRow {
  readonly category: string;
  readonly currency: string;
  readonly total_minor: number;
  readonly entry_count: number;
}

/**
 * Approved and paid expenses only.
 *
 * `pending` and `rejected` rows are excluded: a pending expense is an
 * intention, and counting it as spend would misstate the period.
 */
const EXPENSE_BY_CATEGORY_SQL = `
SELECT
  category,
  currency,
  COALESCE(SUM(amount_minor), 0) AS total_minor,
  COUNT(*) AS entry_count
FROM expenses
WHERE business_id = $1
  AND status IN ('approved', 'paid')
  AND expense_date >= $2::date
  AND expense_date < $3::date
GROUP BY category, currency
ORDER BY total_minor DESC
`.trim();

export async function loadExpenseByCategory(
  database: DatabaseClient,
  businessId: BusinessId,
  from: Date,
  to: Date,
): Promise<readonly ExpenseCategoryTotal[]> {
  const rows = await tenantQuery<ExpenseRow>(database, businessId, EXPENSE_BY_CATEGORY_SQL, [
    toDateOnly(from),
    toDateOnly(to),
  ]);
  return rows.map((row) => ({
    category: row.category,
    currency: row.currency as CurrencyCode,
    totalMinor: row.total_minor,
    entryCount: row.entry_count,
  }));
}

export interface RecurringExpense {
  readonly id: string;
  readonly category: string;
  readonly description: string;
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  readonly frequency: string;
  readonly nextDueDate: string;
}

const RECURRING_EXPENSES_SQL = `
SELECT
  id, category, description, amount_minor, currency,
  recurring_frequency, recurring_next_due_date
FROM expenses
WHERE business_id = $1
  AND is_recurring = true
  AND status IN ('approved', 'paid')
  AND recurring_next_due_date IS NOT NULL
ORDER BY recurring_next_due_date
LIMIT $2
`.trim();

export async function loadRecurringExpenses(
  database: DatabaseClient,
  businessId: BusinessId,
  limit: number,
): Promise<readonly RecurringExpense[]> {
  const rows = await tenantQuery<{
    id: string;
    category: string;
    description: string;
    amount_minor: number;
    currency: string;
    recurring_frequency: string;
    recurring_next_due_date: Date | string;
  }>(database, businessId, RECURRING_EXPENSES_SQL, [limit]);

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    description: row.description,
    amountMinor: row.amount_minor,
    currency: row.currency as CurrencyCode,
    frequency: row.recurring_frequency,
    nextDueDate:
      row.recurring_next_due_date instanceof Date
        ? row.recurring_next_due_date.toISOString()
        : new Date(row.recurring_next_due_date).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------

export interface CashFlowForecastFacts {
  readonly id: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly startingCashMinor: number;
  readonly endingCashMinor: number;
  readonly currency: CurrencyCode;
  readonly risks: readonly { readonly type: string; readonly severity: string; readonly description: string }[];
  readonly calculatedAt: string;
}

/**
 * The most recent cash-flow forecast.
 *
 * `risks` is a `jsonb` column written by the deterministic cash-flow service.
 * It is read back as stored rather than recomputed, so the AI cannot disagree
 * with the figure the merchant already saw.
 */
const LATEST_FORECAST_SQL = `
SELECT
  id, period_start, period_end,
  starting_cash_minor, ending_cash_minor, currency, risks, calculated_at
FROM cash_flow_forecasts
WHERE business_id = $1
ORDER BY calculated_at DESC
LIMIT 1
`.trim();

export async function loadLatestCashFlowForecast(
  database: DatabaseClient,
  businessId: BusinessId,
): Promise<CashFlowForecastFacts | null> {
  const rows = await tenantQuery<{
    id: string;
    period_start: Date | string;
    period_end: Date | string;
    starting_cash_minor: number;
    ending_cash_minor: number;
    currency: string;
    risks: unknown;
    calculated_at: Date | string;
  }>(database, businessId, LATEST_FORECAST_SQL);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    periodStart: toIso(row.period_start),
    periodEnd: toIso(row.period_end),
    startingCashMinor: row.starting_cash_minor,
    endingCashMinor: row.ending_cash_minor,
    currency: row.currency as CurrencyCode,
    risks: parseRisks(row.risks),
    calculatedAt: toIso(row.calculated_at),
  };
}

/**
 * Parses the `risks` jsonb column.
 *
 * Anything unrecognised yields an empty list rather than a cast: a malformed
 * risk entry must not become invented financial context.
 */
function parseRisks(value: unknown): CashFlowForecastFacts['risks'] {
  if (!Array.isArray(value)) return [];
  const risks: { type: string; severity: string; description: string }[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.type !== 'string') continue;
    risks.push({
      type: record.type,
      severity: typeof record.severity === 'string' ? record.severity : 'info',
      description: typeof record.description === 'string' ? record.description : '',
    });
  }
  return risks;
}

// ---------------------------------------------------------------------------
// Profit leaks
// ---------------------------------------------------------------------------

export interface ProfitLeakFact {
  readonly id: string;
  readonly category: string;
  readonly severity: string;
  readonly title: string;
  readonly description: string;
  readonly impactMinor: number;
  readonly currency: CurrencyCode;
  readonly impactPeriod: string;
  readonly status: string;
  readonly detectedAt: string;
}

const PROFIT_LEAKS_SQL = `
SELECT
  id, category, severity, title, description,
  impact_minor, currency, impact_period, status, detected_at
FROM profit_leaks
WHERE business_id = $1
  AND status IN ('active', 'acknowledged')
  AND ($2::text[] IS NULL OR category = ANY($2::text[]))
ORDER BY
  CASE severity
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    ELSE 4
  END,
  impact_minor DESC
LIMIT $3
`.trim();

export async function loadProfitLeaks(
  database: DatabaseClient,
  businessId: BusinessId,
  options: { readonly categories?: readonly string[]; readonly limit: number },
): Promise<readonly ProfitLeakFact[]> {
  const rows = await tenantQuery<{
    id: string;
    category: string;
    severity: string;
    title: string;
    description: string;
    impact_minor: number;
    currency: string;
    impact_period: string;
    status: string;
    detected_at: Date | string;
  }>(database, businessId, PROFIT_LEAKS_SQL, [
    options.categories ? [...options.categories] : null,
    options.limit,
  ]);

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    severity: row.severity,
    title: row.title,
    description: row.description,
    impactMinor: row.impact_minor,
    currency: row.currency as CurrencyCode,
    impactPeriod: row.impact_period,
    status: row.status,
    detectedAt: toIso(row.detected_at),
  }));
}

// ---------------------------------------------------------------------------
// Document inventory (how much context exists at all)
// ---------------------------------------------------------------------------

export interface DocumentCoverageFact {
  readonly sourceType: string;
  readonly documentCount: number;
  readonly indexedChunkCount: number;
}

const DOCUMENT_COVERAGE_SQL = `
SELECT
  d.source_type,
  COUNT(DISTINCT d.id) AS document_count,
  COUNT(e.id) AS indexed_chunk_count
FROM documents d
LEFT JOIN document_embeddings e
  ON e.document_id = d.id
 AND e.business_id = $1
WHERE d.business_id = $1
  AND d.status NOT IN ('rejected', 'failed')
GROUP BY d.source_type
ORDER BY document_count DESC
`.trim();

/**
 * How much retrievable context exists, by source type.
 *
 * Lets the context compiler distinguish "retrieval found nothing" from
 * "retrieval found nothing because nothing has been indexed yet" — the two
 * demand very different answers from the model.
 */
export async function loadDocumentCoverage(
  database: DatabaseClient,
  businessId: BusinessId,
): Promise<readonly DocumentCoverageFact[]> {
  const rows = await tenantQuery<{
    source_type: string;
    document_count: number;
    indexed_chunk_count: number;
  }>(database, businessId, DOCUMENT_COVERAGE_SQL);

  return rows.map((row) => ({
    sourceType: row.source_type,
    documentCount: row.document_count,
    indexedChunkCount: row.indexed_chunk_count,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` in UTC, for `date` columns. */
function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
