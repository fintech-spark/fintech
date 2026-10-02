// Every SQL statement used by the analytics read model.
//
// Kept apart from the repository class so both files stay inside the repository's
// 800-line ceiling. Each statement is a fixed literal: no value is ever
// interpolated, and every tenant table is filtered on `business_id = $1` with the
// tenant id bound as a parameter. Periods are half-open, `[from, to)`.
//
// Parameters are referenced by index only, so a mismatch between a statement and
// the array passed with it is a type error at the call site rather than a wrong
// query at runtime.

/**
 * Formats a fixed set of strings as a PostgreSQL `text[]` bind literal.
 *
 * Values are validated rather than escaped: anything containing a character outside
 * `[A-Za-z0-9_]` is rejected outright. These lists are internal constants today, so a
 * rejection can only mean a programming error, and refusing is preferable to silently
 * escaping a value into a different string than the one the caller compared against.
 */
export function asTextArrayLiteral(values: readonly string[]): string {
  for (const value of values) {
    if (!/^[A-Za-z0-9_]+$/.test(value)) {
      throw new RangeError(
        `Refusing to bind "${value}" as a status literal: only word characters are accepted.`,
      );
    }
  }
  return `{${values.map((value) => `"${value}"`).join(',')}}`;
}


export const SALE_TOTALS_SQL = `
SELECT
  t.currency::text                                                      AS currency,
  COALESCE(SUM(CASE WHEN t.type = $4 THEN t.subtotal_minor END), 0)     AS gross_revenue_minor,
  COALESCE(SUM(CASE WHEN t.type = $4 THEN t.discount_minor END), 0)     AS discount_minor,
  COALESCE(SUM(CASE WHEN t.type = $4 THEN t.tax_minor END), 0)          AS tax_minor,
  COALESCE(SUM(CASE WHEN t.type = $4 THEN t.total_minor END), 0)        AS total_invoiced_minor,
  COALESCE(SUM(CASE WHEN t.type = $5 THEN t.total_minor END), 0)        AS refund_minor,
  COUNT(*) FILTER (WHERE t.type = $4)::int                             AS sale_count,
  COALESCE(SUM(line.quantity), 0)                                      AS quantity_sold,
  COUNT(line.id)::int                                                  AS line_count,
  COUNT(*) FILTER (WHERE line.id IS NOT NULL AND line.product_id IS NULL)::int
                                                                        AS uncosted_line_count,
  COALESCE(SUM(line.cogs_minor), 0)                                    AS cogs_minor
FROM transactions t
LEFT JOIN LATERAL (
  SELECT
    ti.product_id,
    ti.quantity,
    CASE WHEN p.cost_price_minor IS NULL THEN NULL
         ELSE ROUND(p.cost_price_minor * ti.quantity)::bigint
    END AS cogs_minor
  FROM transaction_items ti
  LEFT JOIN products p ON p.id = ti.product_id AND p.business_id = t.business_id
  WHERE ti.transaction_id = t.id
) line ON true
WHERE t.business_id = $1
  AND t.transaction_date >= $2
  AND t.transaction_date <  $3
  AND t.status = ANY($6::text[])
GROUP BY t.currency
ORDER BY t.currency
`;

export const OPERATING_EXPENSE_TOTAL_SQL = `
SELECT COALESCE(SUM(e.amount_minor), 0)::bigint AS total_minor
FROM expenses e
WHERE e.business_id = $1
  AND e.expense_date >= $2
  AND e.expense_date <  $3
  AND e.status = ANY($4::text[])
`;

export const EXPENSE_BY_CATEGORY_SQL = `
SELECT
  e.category::text   AS category,
  e.status::text     AS status,
  COALESCE(SUM(e.amount_minor), 0)::bigint AS amount_minor,
  COUNT(*)::int      AS entry_count
FROM expenses e
WHERE e.business_id = $1
  AND e.expense_date >= $2
  AND e.expense_date <  $3
  AND e.status = ANY($4::text[])
GROUP BY e.category, e.status
ORDER BY amount_minor DESC, e.category ASC, e.status ASC
`;

export const INVENTORY_VALUATION_SQL = `
SELECT
  COALESCE(SUM(ROUND(p.cost_price_minor * p.current_stock)), 0)::bigint AS value_minor,
  COUNT(*)::int AS product_count
FROM products p
WHERE p.business_id = $1
`;

export const OPEN_RECEIVABLES_SQL = `
SELECT
  COALESCE(SUM(r.amount_minor - r.paid_amount_minor), 0)::bigint      AS open_minor,
  COUNT(*) FILTER (WHERE r.status = ANY($3::text[]))::int             AS open_count,
  COALESCE(SUM(CASE WHEN r.due_date < $2
                     THEN r.amount_minor - r.paid_amount_minor
                     ELSE 0 END), 0)::bigint                          AS overdue_minor,
  COUNT(*)::int                                                       AS record_count
FROM receivables r
WHERE r.business_id = $1
`;

export const OPEN_PAYABLES_SQL = `
SELECT
  COALESCE(SUM(p.amount_minor - p.paid_amount_minor), 0)::bigint AS open_minor,
  COUNT(*) FILTER (WHERE p.status = ANY($3::text[]))::int        AS open_count,
  COALESCE(SUM(CASE WHEN p.due_date < $2
                     THEN p.amount_minor - p.paid_amount_minor
                     ELSE 0 END), 0)::bigint                    AS overdue_minor,
  COUNT(*)::int                                                   AS record_count
FROM payables p
WHERE p.business_id = $1
`;

export const LEDGER_CASH_SQL = `
WITH tx AS (
  SELECT t.type::text AS type, t.total_minor
  FROM transactions t
  WHERE t.business_id = $1
    AND t.transaction_date <  $3
    AND t.status = ANY($4::text[])
),
exp AS (
  SELECT COALESCE(SUM(e.amount_minor), 0)::bigint AS expenses_paid_minor
  FROM expenses e
  WHERE e.business_id = $1
    AND e.expense_date <  $3
    AND e.status = ANY($5::text[])
)
SELECT
  COALESCE((
    SELECT SUM(t2.total_minor)
    FROM transactions t2
    WHERE t2.business_id = $1
      AND t2.transaction_date >= $2
      AND t2.transaction_date <  $3
      AND t2.status = ANY($4::text[])
      AND t2.type IN ('sale', 'payment')
  ), 0)::bigint                                        AS opening_cash_minor,
  COALESCE(SUM(CASE WHEN type = 'sale'    THEN total_minor END), 0)::bigint AS sales_received_minor,
  COALESCE(SUM(CASE WHEN type = 'payment' THEN total_minor END), 0)::bigint AS customer_payments_minor,
  COALESCE(SUM(CASE WHEN type = 'purchase' THEN total_minor END), 0)::bigint AS purchase_paid_minor,
  COALESCE(SUM(CASE WHEN type = 'refund'   THEN total_minor END), 0)::bigint AS refunds_paid_minor,
  (SELECT expenses_paid_minor FROM exp)                AS expenses_paid_minor,
  COUNT(*)::int                                        AS recognised_transaction_count
FROM tx
`;

/**
 * Open receivables already past the business's configured overdue threshold.
 * The threshold is a bound parameter so a merchant's own setting, not a constant
 * baked into this file, decides what counts as overdue.
 */
export const OVERDUE_RECEIVABLES_SQL = `
SELECT
  r.id::text                                                        AS id,
  r.customer_id::text                                               AS counterparty_id,
  COALESCE(c.name, 'Unknown')::text                                 AS counterparty_name,
  (r.amount_minor - r.paid_amount_minor)::bigint                   AS open_minor,
  r.due_date                                                        AS due_date,
  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz - r.due_date)) / 86400))::int
                                                                    AS days_overdue
FROM receivables r
LEFT JOIN customers c ON c.id = r.customer_id AND c.business_id = r.business_id
WHERE r.business_id = $1
  AND r.status = ANY($3::text[])
  AND r.amount_minor > r.paid_amount_minor
  AND r.due_date <= $2::timestamptz - (GREATEST($4::int, 0) * INTERVAL '1 day')
ORDER BY r.due_date ASC, r.id ASC
LIMIT $5
`;

export const OPEN_RECEIVABLE_OBLIGATIONS_SQL = `
SELECT
  r.id::text                                                        AS id,
  r.customer_id::text                                               AS counterparty_id,
  (r.amount_minor - r.paid_amount_minor)::bigint                   AS open_minor,
  r.due_date                                                        AS due_date,
  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz - r.due_date)) / 86400))::int
                                                                    AS days_overdue
FROM receivables r
WHERE r.business_id = $1
  AND r.status = ANY($3::text[])
  AND r.amount_minor > r.paid_amount_minor
ORDER BY r.due_date ASC, r.id ASC
LIMIT $4
`;

export const OPEN_PAYABLE_OBLIGATIONS_SQL = `
SELECT
  p.id::text                                                        AS id,
  p.supplier_id::text                                               AS counterparty_id,
  (p.amount_minor - p.paid_amount_minor)::bigint                   AS open_minor,
  p.due_date                                                        AS due_date,
  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz - p.due_date)) / 86400))::int
                                                                    AS days_overdue
FROM payables p
WHERE p.business_id = $1
  AND p.status = ANY($3::text[])
  AND p.amount_minor > p.paid_amount_minor
ORDER BY p.due_date ASC, p.id ASC
LIMIT $4
`;

export const RECURRING_EXPENSES_SQL = `
SELECT
  e.id::text                AS id,
  e.category::text          AS category,
  e.amount_minor::bigint    AS amount_minor,
  e.currency::text          AS currency,
  e.recurring_frequency::text AS recurring_frequency,
  e.recurring_next_due_date AS recurring_next_due_date,
  e.recurring_end_date      AS recurring_end_date
FROM expenses e
WHERE e.business_id = $1
  AND e.is_recurring
  AND e.recurring_next_due_date IS NOT NULL
  AND e.status = ANY($2::text[])
ORDER BY e.recurring_next_due_date ASC, e.id ASC
LIMIT $3
`;

export const DATED_EXPENSES_SQL = `
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

export const REPORTING_SETTINGS_SQL = `
SELECT
  b.currency::text                 AS currency,
  b.timezone::text                 AS timezone,
  b.overdue_threshold_days::int    AS overdue_threshold_days
FROM businesses b
WHERE b.id = $1
LIMIT 1
`;

/**
 * Per-product revenue and derived cost over the period. Uses the same cost
 * basis as `SALE_TOTALS_SQL` so product figures always reconcile with the
 * snapshot they are compared against.
 */
export const PRODUCT_PERFORMANCE_SQL = `
SELECT
  ti.product_id::text                                                AS product_id,
  MIN(p.name)::text                                                  AS product_name,
  COALESCE(SUM(ti.quantity), 0)                                      AS quantity,
  COALESCE(SUM(ti.unit_price_minor * ti.quantity - ti.discount_minor), 0)::bigint
                                                                     AS revenue_minor,
  COALESCE(SUM(CASE WHEN p.cost_price_minor IS NULL THEN 0
                    ELSE ROUND(p.cost_price_minor * ti.quantity) END), 0)::bigint
                                                                     AS cogs_minor,
  COUNT(*) FILTER (WHERE p.cost_price_minor IS NULL)::int            AS uncosted_line_count,
  COUNT(*)::int                                                      AS line_count
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
LEFT JOIN products p ON p.id = ti.product_id AND p.business_id = t.business_id
WHERE t.business_id = $1
  AND ti.product_id = $2
  AND t.type = $5
  AND t.status = ANY($6::text[])
  AND t.transaction_date >= $3
  AND t.transaction_date <  $4
GROUP BY ti.product_id
`;

export const PRODUCT_SALES_SQL = `
SELECT
  ti.product_id::text                                                AS product_id,
  MIN(p.name)::text                                                  AS product_name,
  COALESCE(SUM(ti.quantity), 0)                                      AS quantity,
  COALESCE(SUM(ti.unit_price_minor * ti.quantity - ti.discount_minor), 0)::bigint
                                                                     AS revenue_minor,
  COALESCE(SUM(ti.discount_minor), 0)::bigint                        AS discount_minor,
  COALESCE(SUM(CASE WHEN p.cost_price_minor IS NULL THEN 0
                    ELSE ROUND(p.cost_price_minor * ti.quantity) END), 0)::bigint
                                                                     AS cogs_minor,
  COUNT(*) FILTER (WHERE p.cost_price_minor IS NULL)::int            AS uncosted_line_count,
  COUNT(*)::int                                                      AS line_count
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
LEFT JOIN products p ON p.id = ti.product_id AND p.business_id = t.business_id
WHERE t.business_id = $1
  AND t.type = $4
  AND t.status = ANY($5::text[])
  AND t.transaction_date >= $2
  AND t.transaction_date <  $3
  AND ti.product_id IS NOT NULL
GROUP BY ti.product_id
`;

/**
 * Revenue by counterparty, bounded by `limit`. The cap is a bound parameter and
 * also enforced by `revenue_concentration_limit` below, so a caller cannot turn
 * this into an unbounded aggregation.
 */
export const REVENUE_CONCENTRATION_SQL = `
SELECT
  t.counterparty_id::text                                          AS counterparty_id,
  t.counterparty_type::text                                        AS counterparty_type,
  COALESCE(SUM(t.subtotal_minor - t.discount_minor), 0)::bigint   AS revenue_minor,
  COUNT(*)::int                                                    AS transaction_count
FROM transactions t
WHERE t.business_id = $1
  AND t.type = $4
  AND t.status = ANY($5::text[])
  AND t.transaction_date >= $2
  AND t.transaction_date <  $3
GROUP BY t.counterparty_id, t.counterparty_type
ORDER BY revenue_minor DESC, t.counterparty_id ASC
LIMIT LEAST(GREATEST($6::int, 1), 500)
`;

export const PURCHASE_PRICE_SQL = `
SELECT
  ti.product_id::text                                                             AS product_id,
  ROUND(SUM(ti.unit_price_minor * ti.quantity) / NULLIF(SUM(ti.quantity), 0))::bigint
                                                                                  AS weighted_unit_price_minor,
  COALESCE(SUM(ti.quantity), 0)                                                   AS quantity,
  COUNT(*)::int                                                                   AS line_count
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
WHERE t.business_id = $1
  AND t.type = $4
  AND t.status = ANY($5::text[])
  AND t.transaction_date >= $2
  AND t.transaction_date <  $3
  AND ti.product_id IS NOT NULL
GROUP BY ti.product_id
HAVING SUM(ti.quantity) > 0
`;

export const PRODUCTS_FOR_ANALYSIS_SQL = `
SELECT
  p.id::text             AS id,
  p.name::text           AS name,
  p.category::text       AS category,
  p.status::text         AS status,
  p.supplier_id::text    AS supplier_id,
  p.cost_price_minor::bigint    AS cost_price_minor,
  p.selling_price_minor::bigint AS selling_price_minor,
  p.current_stock                 AS current_stock,
  p.reorder_point                 AS reorder_point,
  p.created_at                    AS created_at
FROM products p
WHERE p.business_id = $1
ORDER BY p.id ASC
LIMIT $2
`;
/** Upper bound on obligations returned by one projection read. */
export const MAX_OBLIGATION_ROWS = 500;

/** Upper bound on products returned by one stock or margin analysis read. */
export const MAX_PRODUCT_ROWS = 1_000;

/** Upper bound on recurring expenses expanded by one projection read. */
export const MAX_RECURRING_ROWS = 200;

/** Upper bound on dated expenses read for one horizon. */
export const MAX_DATED_EXPENSE_ROWS = 1_000;
