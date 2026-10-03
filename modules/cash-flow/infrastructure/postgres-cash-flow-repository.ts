import type { BusinessId } from '@/lib/types';
import type { TenantDatabaseClient } from '@/lib/database';
import { sumMinorUnits, type HalfOpenPeriod } from '@/modules/analytics';
import { OPEN_PAYABLE_STATUSES, OPEN_RECEIVABLE_STATUSES } from '@/modules/analytics';
import {
  RECOGNIZED_EXPENSE_STATUSES,
  RECOGNIZED_TRANSACTION_STATUSES,
} from '@/modules/analytics';
import type {
  DatedExpenseInput,
  HistoricalPeriodInput,
  ObligationInput,
  RecurringExpenseInput,
} from '../domain/types';
import { asRecurringFrequency } from './cash-flow-repository';
import type { CashFlowRepository } from './cash-flow-repository';

// PostgreSQL read model for cash-flow intelligence.
//
// Every statement is tenant-scoped on `business_id = $1` and bounded: obligations
// are limited by a window, history by an explicit `limit` bound as a parameter,
// and recurring expenses by the horizon. No statement accepts a caller-supplied
// sort key, column list or SQL fragment.
//
// Counterparty names are joined for display only. They are merchant-supplied free
// text and are never used in a comparison, a key or a query.

export class PostgresCashFlowRepository implements CashFlowRepository {
  constructor(private readonly db: TenantDatabaseClient) {}

  async getReportingSettings(businessId: BusinessId) {
    const rows = await this.db.query<{ currency: string; timezone: string }>(
      REPORTING_SETTINGS_SQL,
      [businessId],
    );
    return {
      currency: rows[0]?.currency ?? 'INR',
      timezone: rows[0]?.timezone ?? 'Asia/Kolkata',
    };
  }

  /**
   * Ledger-derived cash before the horizon.
   *
   * Sums every recognised cash-bearing transaction from the beginning of the
   * ledger up to `horizonStart`, then adds the movement inside the clamped
   * window. `hasRecords` distinguishes "the merchant's books are empty" from
   * "the merchant genuinely has no cash", which are very different warnings.
   */
  async getOpeningCash(businessId: BusinessId, horizonStart: Date) {
    const rows = await this.db.query<{ cash_minor: number; record_count: number }>(
      OPENING_CASH_SQL,
      [
        businessId,
        horizonStart,
        asTextArrayLiteral(RECOGNIZED_TRANSACTION_STATUSES),
        asTextArrayLiteral(RECOGNIZED_EXPENSE_STATUSES),
      ],
    );
    return {
      cashMinor: rows[0]?.cash_minor ?? 0,
      hasRecords: (rows[0]?.record_count ?? 0) > 0,
    };
  }

  async getReceivablesForProjection(
    businessId: BusinessId,
    asOf: Date,
  ): Promise<readonly ObligationInput[]> {
    const rows = await this.db.query<ObligationSqlRow>(OPEN_RECEIVABLES_SQL, [
      businessId,
      asOf,
      asTextArrayLiteral(OPEN_RECEIVABLE_STATUSES),
      MAX_OBLIGATION_ROWS,
    ]);
    return rows.map((row) => toObligation(row, 'customer'));
  }

  async getPayablesForProjection(
    businessId: BusinessId,
    asOf: Date,
  ): Promise<readonly ObligationInput[]> {
    const rows = await this.db.query<ObligationSqlRow>(OPEN_PAYABLES_SQL, [
      businessId,
      asOf,
      asTextArrayLiteral(OPEN_PAYABLE_STATUSES),
      MAX_OBLIGATION_ROWS,
    ]);
    return rows.map((row) => toObligation(row, 'supplier'));
  }

  async getDatedExpensesForProjection(
    businessId: BusinessId,
    horizon: HalfOpenPeriod,
  ): Promise<readonly DatedExpenseInput[]> {
    const rows = await this.db.query<DatedExpenseSqlRow>(DATED_EXPENSES_SQL, [
      businessId,
      horizon.from,
      horizon.to,
      asTextArrayLiteral(RECOGNIZED_EXPENSE_STATUSES),
      MAX_DATED_EXPENSE_ROWS,
    ]);
    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      amountMinor: row.amount_minor,
      expenseDate: row.expense_date,
    }));
  }

  async getRecurringExpensesForProjection(
    businessId: BusinessId,
  ): Promise<readonly RecurringExpenseInput[]> {
    const rows = await this.db.query<RecurringExpenseSqlRow>(RECURRING_EXPENSES_SQL, [
      businessId,
      asTextArrayLiteral(RECOGNIZED_EXPENSE_STATUSES),
      MAX_RECURRING_ROWS,
    ]);
    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      amountMinor: row.amount_minor,
      frequency: asRecurringFrequency(row.recurring_frequency ?? 'monthly'),
      nextDueDate: row.recurring_next_due_date,
      endDate: row.recurring_end_date,
    }));
  }

  /**
   * Recognised inflow per completed prior month, capped at `limit` rows.
   *
   * `date_trunc('month', ...)` matches the monthly granularity the engine uses
   * for historical extrapolation, so a month of history is comparable to a month
   * of projection. `LIMIT` is a bound parameter clamped in SQL.
   */
  async getHistoricalInflows(
    businessId: BusinessId,
    before: Date,
    limit: number,
  ): Promise<readonly HistoricalPeriodInput[]> {
    const rows = await this.db.query<HistoricalInflowSqlRow>(HISTORICAL_INFLOWS_SQL, [
      businessId,
      before,
      asTextArrayLiteral(RECOGNIZED_TRANSACTION_STATUSES),
      limit,
    ]);
    return rows.map((row) => ({
      from: row.period_start,
      to: row.period_end,
      inflowMinor: row.inflow_minor,
    }));
  }
}

/** Maximum obligations returned by one projection read. */
export const MAX_OBLIGATION_ROWS = 500;

/** Maximum recurring expenses expanded by one projection read. */
export const MAX_RECURRING_ROWS = 200;

/**
 * Maximum dated expenses read for one horizon.
 *
 * `DATED_EXPENSES_SQL` orders by `expense_date` and bounds the result with
 * `LIMIT $5`, so this value must be bound. Omitting it made every projection
 * read fail with pgCode 08P01 ("bind message supplies 4 parameters, but the
 * prepared statement requires 5"), which is how the defect was found: the
 * statement had never been executed against a real server.
 */
export const MAX_DATED_EXPENSE_ROWS = 1_000;

function toObligation(row: ObligationSqlRow, side: 'customer' | 'supplier'): ObligationInput {
  return {
    id: row.id,
    counterpartyId: side === 'customer' ? (row.customer_id ?? row.id) : (row.supplier_id ?? row.id),
    counterpartyName: (row.counterparty_name ?? 'Unknown').slice(0, 200),
    openMinor: row.open_minor,
    dueDate: row.due_date,
    daysOverdue: row.days_overdue,
  };
}

/**
 * Formats a fixed set of strings as a PostgreSQL `text[]` bind literal.
 *
 * Values are validated rather than escaped: anything containing a quote, a
 * backslash, a brace or whitespace is rejected. These lists are internal
 * constants, so a rejection can only mean a programming error.
 */
function asTextArrayLiteral(values: readonly string[]): string {
  for (const value of values) {
    if (!/^[A-Za-z0-9_]+$/.test(value)) {
      throw new RangeError(
        `Refusing to bind "${value}" as a status literal: only word characters are accepted.`,
      );
    }
  }
  return `{${values.map((value) => `"${value}"`).join(',')}}`;
}

interface ObligationSqlRow {
  readonly id: string;
  readonly customer_id?: string;
  readonly supplier_id?: string;
  readonly counterparty_name: string | null;
  readonly open_minor: number;
  readonly due_date: Date;
  readonly days_overdue: number;
}

interface DatedExpenseSqlRow {
  readonly id: string;
  readonly category: string;
  readonly amount_minor: number;
  readonly expense_date: Date;
}

interface RecurringExpenseSqlRow {
  readonly id: string;
  readonly category: string;
  readonly amount_minor: number;
  readonly recurring_frequency: string | null;
  readonly recurring_next_due_date: Date;
  readonly recurring_end_date: Date | null;
}

interface HistoricalInflowSqlRow {
  readonly period_start: Date;
  readonly period_end: Date;
  readonly inflow_minor: number;
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

const REPORTING_SETTINGS_SQL = `
SELECT b.currency::text AS currency, b.timezone::text AS timezone
FROM businesses b
WHERE b.id = $1
LIMIT 1
`;

const OPENING_CASH_SQL = `
WITH cash_tx AS (
  SELECT t.type::text AS type, t.total_minor
  FROM transactions t
  WHERE t.business_id = $1
    AND t.transaction_date < $2
    AND t.status = ANY($3::text[])
),
cash_exp AS (
  SELECT COALESCE(SUM(e.amount_minor), 0)::bigint AS paid_minor
  FROM expenses e
  WHERE e.business_id = $1
    AND e.expense_date < $2
    AND e.status = ANY($4::text[])
)
SELECT
  (
    COALESCE(SUM(CASE WHEN type IN ('sale', 'payment') THEN total_minor ELSE 0 END), 0)
    - COALESCE((SELECT paid_minor FROM cash_exp), 0)
    - COALESCE(SUM(CASE WHEN type IN ('purchase', 'refund') THEN total_minor ELSE 0 END), 0)
  )::bigint AS cash_minor,
  (SELECT COUNT(*) FROM cash_tx)::int AS record_count
FROM cash_tx
`;

const OPEN_RECEIVABLES_SQL = `
SELECT
  r.id::text                       AS id,
  r.customer_id::text              AS customer_id,
  c.name::text                     AS counterparty_name,
  (r.amount_minor - r.paid_amount_minor)::bigint AS open_minor,
  r.due_date                       AS due_date,
  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz - r.due_date)) / 86400))::int
                                     AS days_overdue
FROM receivables r
LEFT JOIN customers c ON c.id = r.customer_id AND c.business_id = r.business_id
WHERE r.business_id = $1
  AND r.status = ANY($3::text[])
  AND r.amount_minor > r.paid_amount_minor
ORDER BY r.due_date ASC, r.id ASC
LIMIT LEAST(GREATEST($4::int, 1), 500)
`;

const OPEN_PAYABLES_SQL = `
SELECT
  p.id::text                       AS id,
  p.supplier_id::text              AS supplier_id,
  s.name::text                     AS counterparty_name,
  (p.amount_minor - p.paid_amount_minor)::bigint AS open_minor,
  p.due_date                       AS due_date,
  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz - p.due_date)) / 86400))::int
                                     AS days_overdue
FROM payables p
LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.business_id = p.business_id
WHERE p.business_id = $1
  AND p.status = ANY($3::text[])
  AND p.amount_minor > p.paid_amount_minor
ORDER BY p.due_date ASC, p.id ASC
LIMIT LEAST(GREATEST($4::int, 1), 500)
`;

const DATED_EXPENSES_SQL = `
SELECT
  e.id::text             AS id,
  e.category::text       AS category,
  e.amount_minor::bigint AS amount_minor,
  e.expense_date         AS expense_date
FROM expenses e
WHERE e.business_id = $1
  AND NOT e.is_recurring
  AND e.expense_date >= $2
  AND e.expense_date <  $3
  AND e.status = ANY($4::text[])
ORDER BY e.expense_date ASC, e.id ASC
LIMIT $5
`;

const RECURRING_EXPENSES_SQL = `
SELECT
  e.id::text                   AS id,
  e.category::text             AS category,
  e.amount_minor::bigint       AS amount_minor,
  e.recurring_frequency::text  AS recurring_frequency,
  e.recurring_next_due_date    AS recurring_next_due_date,
  e.recurring_end_date         AS recurring_end_date
FROM expenses e
WHERE e.business_id = $1
  AND e.is_recurring
  AND e.recurring_next_due_date IS NOT NULL
  AND e.status = ANY($2::text[])
ORDER BY e.recurring_next_due_date ASC, e.id ASC
LIMIT LEAST(GREATEST($3::int, 1), 200)
`;

const HISTORICAL_INFLOWS_SQL = `
SELECT
  date_trunc('month', t.transaction_date)                       AS period_start,
  date_trunc('month', t.transaction_date) + INTERVAL '1 month'   AS period_end,
  COALESCE(SUM(t.total_minor), 0)::bigint                       AS inflow_minor
FROM transactions t
WHERE t.business_id = $1
  AND t.transaction_date < $2
  AND t.status = ANY($3::text[])
  AND t.type IN ('sale', 'payment')
  AND t.transaction_date >= $2::timestamptz - INTERVAL '24 months'
GROUP BY 1
ORDER BY 1 DESC
LIMIT LEAST(GREATEST($4::int, 1), 24)
`;

/** Exported for the SQL-safety test suite. */
export const __testing = { asTextArrayLiteral };

/** Total of a set of minor-unit obligations. */
export function totalObligations(obligations: readonly ObligationInput[]): number {
  return sumMinorUnits(obligations.map((obligation) => obligation.openMinor));
}