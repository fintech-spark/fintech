import { createDatabaseClient } from '@/lib/database';
import type { PostgresDatabaseClient, TenantDatabaseClient } from '@/lib/database';
import type { DatabaseClient } from '@/lib/database';
import { asBusinessId, asUserId, type BusinessId, type TenantContext, type UserRole } from '@/lib/types';

// ---------------------------------------------------------------------------
// Live-database fixtures
//
// Every row is synthetic and deterministic. Two tenants are created so tenant
// isolation is provable rather than asserted: each carries the same row shapes
// with different amounts, so a repository that leaks across the tenant predicate
// returns a number that belongs to the other tenant and the difference is
// numerically visible rather than merely structural.
//
// IDs are namespaced `d4b1...` so cleanup can never touch another agent's data
// or the seed business in `supabase/seed.sql`.
//
// Every statement is parameterised. Nothing derived from a caller is
// concatenated into SQL.
// ---------------------------------------------------------------------------

export const TENANT_A = asBusinessId('d4b10000-0000-4000-8000-000000000001');
export const TENANT_B = asBusinessId('d4b10000-0000-4000-8000-000000000002');
/** A business that exists in no fixture, used to prove empty reads behave. */
export const TENANT_ABSENT = asBusinessId('d4b10000-0000-4000-8000-000000009999');

export const USER_A = 'd4b10000-0000-4000-8000-00000000000a';
/** A second, distinct user inside tenant A. Required for the dual-approval path. */
export const USER_A_SECOND = 'd4b10000-0000-4000-8000-00000000000c';
export const USER_B = 'd4b10000-0000-4000-8000-00000000000b';

export const CUSTOMER_A = 'd4b10000-0000-4000-8000-0000000000d1';
export const CUSTOMER_B_OF_A = 'd4b10000-0000-4000-8000-0000000000d2';
export const SUPPLIER_A = 'd4b10000-0000-4000-8000-0000000000d3';
/** Costed product: cost 8,000, sells 12,000. */
export const PRODUCT_COSTED = 'd4b10000-0000-4000-8000-0000000000d4';
/** Second product with a different cost, so weighted averages stay distinguishable. */
export const PRODUCT_OTHER = 'd4b10000-0000-4000-8000-0000000000d5';

export const CUSTOMER_B = 'd4b10000-0000-4000-8000-0000000000e1';
export const SUPPLIER_B = 'd4b10000-0000-4000-8000-0000000000e2';
export const PRODUCT_B = 'd4b10000-0000-4000-8000-0000000000e3';

export const TX_SALE = 'd4b10000-0000-4000-8000-0000000000f1';
/** Status `draft`: every recognised-status filter must exclude it. */
export const TX_DRAFT = 'd4b10000-0000-4000-8000-0000000000f2';
/** Dated exactly on `PERIOD.from`; a `>=` lower bound must include it. */
export const TX_AT_FROM = 'd4b10000-0000-4000-8000-0000000000f3';
/** Dated exactly on `PERIOD.to`; a `<` upper bound must exclude it. */
export const TX_AT_TO = 'd4b10000-0000-4000-8000-0000000000f4';
export const TX_REFUND = 'd4b10000-0000-4000-8000-0000000000f5';
export const TX_PURCHASE = 'd4b10000-0000-4000-8000-0000000000f6';
export const TX_B_SALE = 'd4b10000-0000-4000-8000-0000000000f7';
/** Dated before PERIOD, so opening-cash reads have history to find. */
export const TX_PRIOR = 'd4b10000-0000-4000-8000-0000000000f8';

export const RECEIVABLE_OVERDUE = 'd4b10000-0000-4000-8000-000000001001';
export const RECEIVABLE_OPEN = 'd4b10000-0000-4000-8000-000000001002';
export const RECEIVABLE_SETTLED = 'd4b10000-0000-4000-8000-000000001003';
export const PAYABLE_OPEN = 'd4b10000-0000-4000-8000-000000001004';
export const RECEIVABLE_B = 'd4b10000-0000-4000-8000-000000001005';
export const PAYABLE_B = 'd4b10000-0000-4000-8000-000000001006';

/**
 * The window every boundary assertion is written against.
 *
 * `TX_AT_FROM` and `TX_AT_TO` sit exactly on these two instants, so a half-open
 * violation changes a total instead of merely looking odd.
 */
export const PERIOD = {
  from: new Date('2026-01-01T00:00:00.000Z'),
  to: new Date('2026-02-01T00:00:00.000Z'),
};

/** Comfortably after both boundary fixtures and after the overdue due date. */
export const AS_OF = new Date('2026-01-20T00:00:00.000Z');

/** Minor units (paise for INR). Named so an assertion reads as arithmetic. */
export const AMOUNT = {
  costedUnitPriceMinor: 12_000,
  costedCostMinor: 8_000,
  costedQuantity: 2,
  costedLineTotalMinor: 24_000,
  costedCogsMinor: 16_000,
  unlinkedUnitPriceMinor: 5_000,
  unlinkedQuantity: 3,
  unlinkedLineTotalMinor: 15_000,
  /** 24,000 + 15,000 across two lines; the transaction header total. */
  saleSubtotalMinor: 39_000,
  draftSubtotalMinor: 999_999,
  atFromSubtotalMinor: 7_000,
  atToSubtotalMinor: 888_888,
  refundTotalMinor: 4_000,
  purchaseQuantity: 4,
  purchaseUnitPriceMinor: 5_000,
  purchaseSubtotalMinor: 20_000,
  /** Deliberately unlike anything in tenant A, so a leak is obvious. */
  tenantBSaleSubtotalMinor: 555_555,
  priorSaleSubtotalMinor: 1_000,
  receivableOverdueMinor: 30_000,
  receivableOverduePaidMinor: 5_000,
  receivableOpenMinor: 20_000,
  receivableSettledMinor: 90_000,
  receivableBMinor: 4_242,
  payableOpenMinor: 12_000,
  payableBMinor: 1_357,
  expenseRentMinor: 25_000,
  expenseUtilitiesMinor: 18_000,
  expensePendingMinor: 77_000,
  expenseRecurringMinor: 9_000,
  expenseBRentMinor: 3_131,
  /**
   * Recognised operating expense for tenant A inside PERIOD: rent 25,000 +
   * utilities 18,000 + the APPROVED recurring fee 9,000. The recurring row is
   * dated inside the window and OPERATING_EXPENSE_TOTAL_SQL does not exclude
   * recurring expenses, so it belongs here. Marketing 77,000 is pending and
   * excluded.
   */
  tenantARecognisedExpenseMinor: 52_000,
} as const;

/**
 * Tenant totals an assertion can compare against, derived once from the fixture
 * so the expected values and the inserted values cannot drift apart.
 */
export const EXPECTED = {
  /** Only TX_SALE and TX_AT_FROM fall inside [from, to). */
  grossRevenueMinor: AMOUNT.saleSubtotalMinor + AMOUNT.atFromSubtotalMinor,
  saleCount: 2,
  /** Only TX_SALE carries lines: two of them. */
  lineCount: 2,
  quantitySold: AMOUNT.costedQuantity + AMOUNT.unlinkedQuantity,
  /** The unlinked line has no derivable cost. */
  uncostedLineCount: 1,
  cogsMinor: AMOUNT.costedCogsMinor,
  refundMinor: AMOUNT.refundTotalMinor,
  recognisedExpenseMinor: AMOUNT.tenantARecognisedExpenseMinor,
  receivableOpenMinor:
    AMOUNT.receivableOverdueMinor -
    AMOUNT.receivableOverduePaidMinor +
    AMOUNT.receivableOpenMinor,
  overdueReceivableMinor: AMOUNT.receivableOverdueMinor - AMOUNT.receivableOverduePaidMinor,
  payableOpenMinor: AMOUNT.payableOpenMinor,
  inventoryValueMinor: AMOUNT.costedCostMinor * 40 + 4_000 * 25,
  productCount: 2,
} as const;

/** A tenant context shaped exactly as a route handler would supply it. */
export function tenantContext(
  businessId: BusinessId,
  userId: string,
  role: UserRole,
): TenantContext {
  return {
    businessId,
    userId: asUserId(userId),
    role,
    correlationId: `live-db-${businessId}-${role}`,
  };
}

/**
 * Opens a real connection.
 *
 * Throws with an actionable message when `DATABASE_URL` is absent or the server
 * is unreachable. It never returns a stub and never falls back to another
 * engine: a green result must mean the statements ran on PostgreSQL.
 */
export async function openLiveDatabase(): Promise<PostgresDatabaseClient> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.trim() === '') {
    throw new Error(
      'DATABASE_URL is not set, so the live repository suite cannot run. Start the ' +
        'verify container and export a URL, for example: ' +
        'DATABASE_URL=postgresql://postgres:postgres@localhost:55432/merchant_brain npm run test:db:live',
    );
  }

  const client = createDatabaseClient({ connectionString: url });
  try {
    await client.query('SELECT 1');
  } catch (error) {
    await client.close();
    throw new Error(
      `Could not reach PostgreSQL at the configured DATABASE_URL (${redact(url)}). ` +
        `Confirm the verify container is running and that migrations have been applied. ` +
        `Cause: ${(error as Error).message}`,
    );
  }
  return client;
}

/** Strips the password before a connection string reaches a log line. */
function redact(url: string): string {
  return url.replace(/\/\/([^:]+):[^@]*@/, '//$1:***@');
}

/** Real tenant-scoped client, exactly as production wiring obtains one. */
export function tenantClient(db: DatabaseClient, businessId: BusinessId): TenantDatabaseClient {
  return db.forTenant(businessId);
}

type Executor = {
  execute(sql: string, params?: readonly unknown[]): Promise<number>;
};

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

/** Creates both tenants and their ledger. Re-running is safe. */
export async function seedLiveFixtures(db: DatabaseClient): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO businesses (id, name, type, status, currency, timezone, overdue_threshold_days)
       VALUES ($1, 'Live Tenant A', 'retail', 'active', 'INR', 'Asia/Kolkata', 30),
              ($2, 'Live Tenant B', 'retail', 'active', 'INR', 'Asia/Kolkata', 30)`,
      [TENANT_A, TENANT_B],
    );

    await tx.execute(
      `INSERT INTO users (id, email, name) VALUES
         ($1, 'live-a@example.invalid',  'Live Tenant A Owner'),
         ($2, 'live-a2@example.invalid', 'Live Tenant A Second Approver'),
         ($3, 'live-b@example.invalid',  'Live Tenant B Owner')`,
      [USER_A, USER_A_SECOND, USER_B],
    );

    // Tenant A gets two owners so the dual-approval path is exercisable.
    await tx.execute(
      `INSERT INTO business_members (id, business_id, user_id, role, status) VALUES
         ('d4b10000-0000-4000-8000-000000000201', $1, $2, 'owner', 'active'),
         ('d4b10000-0000-4000-8000-000000000202', $1, $3, 'owner', 'active'),
         ('d4b10000-0000-4000-8000-000000000203', $4, $5, 'owner', 'active')`,
      [TENANT_A, USER_A, USER_A_SECOND, TENANT_B, USER_B],
    );

    await tx.execute(
      `INSERT INTO customers (id, business_id, name, status, currency) VALUES
         ($1, $3, 'Live Customer One', 'active', 'INR'),
         ($2, $3, 'Live Customer Two', 'active', 'INR'),
         ($4, $5, 'Live Tenant B Customer', 'active', 'INR')`,
      [CUSTOMER_A, CUSTOMER_B_OF_A, TENANT_A, CUSTOMER_B, TENANT_B],
    );

    await tx.execute(
      `INSERT INTO suppliers (id, business_id, name, status, currency) VALUES
         ($1, $2, 'Live Supplier',        'active', 'INR'),
         ($3, $4, 'Live Tenant B Supplier', 'active', 'INR')`,
      [SUPPLIER_A, TENANT_A, SUPPLIER_B, TENANT_B],
    );

    await tx.execute(
      `INSERT INTO products
         (id, business_id, name, sku, unit, cost_price_minor, selling_price_minor,
          currency, current_stock, reorder_point, reorder_quantity, status, supplier_id)
       VALUES
         ($1,  $3,  'Live Costed Product', 'LIVE-A1', 'piece', $4,  $5,  'INR', 40, 10, 20, 'active', $6),
         ($2,  $3,  'Live Other Product',  'LIVE-A2', 'kg',    4000, 6000, 'INR', 25,  5, 10, 'active', NULL),
         ($7,  $8,  'Live Tenant B Product', 'LIVE-B1', 'piece', 1000, 2000, 'INR', 5, 1, 2, 'active', NULL)`,
      [
        PRODUCT_COSTED,
        PRODUCT_OTHER,
        TENANT_A,
        AMOUNT.costedCostMinor,
        AMOUNT.costedUnitPriceMinor,
        SUPPLIER_A,
        PRODUCT_B,
        TENANT_B,
      ],
    );

    await insertLedger(tx);
    await insertObligations(tx);
    await insertExpenses(tx);
  });
}

/**
 * Ledger rows.
 *
 * `TX_SALE` is the row that proves the fan-out fix: its header total is 39,000
 * across two lines of 24,000 and 15,000, so any statement that sums the header
 * once per line reports 78,000.
 */
async function insertLedger(tx: Executor): Promise<void> {
  await tx.execute(
    `INSERT INTO transactions
       (id, business_id, type, status, counterparty_type, counterparty_id,
        subtotal_minor, discount_minor, tax_minor, total_minor, currency,
        transaction_date, created_by)
     VALUES
       ($1,  $8,  'sale',     'completed', 'customer', $9,  $13, 0, 0, $13, 'INR', '2026-01-10T09:00:00Z', $10),
       ($2,  $8,  'sale',     'draft',     'customer', $9,  $14, 0, 0, $14, 'INR', '2026-01-11T09:00:00Z', $10),
       ($3,  $8,  'sale',     'completed', 'customer', $11, $15, 0, 0, $15, 'INR', $16,                 $10),
       ($4,  $8,  'sale',     'completed', 'customer', $9,  $17, 0, 0, $17, 'INR', $18,                 $10),
       ($5,  $8,  'refund',   'completed', 'customer', $9,  $19, 0, 0, $19, 'INR', '2026-01-12T09:00:00Z', $10),
       ($6,  $8,  'purchase', 'completed', 'supplier', $12, $20, 0, 0, $20, 'INR', '2026-01-05T09:00:00Z', $10),
       ($7,  $21, 'sale',     'completed', 'customer', $22, $23, 0, 0, $23, 'INR', '2026-01-10T09:00:00Z', $24)`,
    [
      TX_SALE,
      TX_DRAFT,
      TX_AT_FROM,
      TX_AT_TO,
      TX_REFUND,
      TX_PURCHASE,
      TX_B_SALE,
      TENANT_A,
      CUSTOMER_A,
      USER_A,
      CUSTOMER_B_OF_A,
      SUPPLIER_A,
      AMOUNT.saleSubtotalMinor,
      AMOUNT.draftSubtotalMinor,
      AMOUNT.atFromSubtotalMinor,
      PERIOD.from.toISOString(),
      AMOUNT.atToSubtotalMinor,
      PERIOD.to.toISOString(),
      AMOUNT.refundTotalMinor,
      AMOUNT.purchaseSubtotalMinor,
      TENANT_B,
      CUSTOMER_B,
      AMOUNT.tenantBSaleSubtotalMinor,
      USER_B,
    ],
  );

  // A completed sale dated BEFORE the period, so getOpeningCash has history to
  // find and the half-open lower bound has something to exclude.
  await tx.execute(
    `INSERT INTO transactions
       (id, business_id, type, status, counterparty_type, counterparty_id,
        subtotal_minor, discount_minor, tax_minor, total_minor, currency,
        transaction_date, created_by)
     VALUES ($1, $2, 'sale', 'completed', 'customer', $3, $4, 0, 0, $4, 'INR', '2025-12-15T09:00:00Z', $5)`,
    [TX_PRIOR, TENANT_A, CUSTOMER_A, AMOUNT.priorSaleSubtotalMinor, USER_A],
  );

  // Only TX_SALE and TX_PURCHASE carry lines. TX_AT_FROM deliberately has none,
  // so `sale_count` (transactions) and `line_count` (items) are distinguishable.
  await tx.execute(
    `INSERT INTO transaction_items
       (id, transaction_id, product_id, product_name, quantity, unit_price_minor,
        discount_minor, tax_minor, total_minor)
     VALUES
       ('d4b10000-0000-4000-8000-000000000301', $1, $3, 'Live Costed Product', $4, $5, 0, 0, $6),
       ('d4b10000-0000-4000-8000-000000000302', $1, NULL, 'Unlinked line',      $7, $8, 0, 0, $9),
       ('d4b10000-0000-4000-8000-000000000303', $2, $10, 'Live Other Product',  $11, $12, 0, 0, $13)`,
    [
      TX_SALE,
      TX_PURCHASE,
      PRODUCT_COSTED,
      AMOUNT.costedQuantity,
      AMOUNT.costedUnitPriceMinor,
      AMOUNT.costedLineTotalMinor,
      AMOUNT.unlinkedQuantity,
      AMOUNT.unlinkedUnitPriceMinor,
      AMOUNT.unlinkedLineTotalMinor,
      PRODUCT_OTHER,
      AMOUNT.purchaseQuantity,
      AMOUNT.purchaseUnitPriceMinor,
      AMOUNT.purchaseSubtotalMinor,
    ],
  );
}

/** Receivables and payables covering overdue, open, settled, and tenant B. */
async function insertObligations(tx: Executor): Promise<void> {
  const OVERDUE_DUE = '2026-01-05T00:00:00Z';
  const OPEN_DUE = '2026-02-15T00:00:00Z';
  const PAYABLE_DUE = '2026-01-25T00:00:00Z';

  // One statement per row. Hand-numbering a multi-row VALUES list is exactly how
  // an unused placeholder slipped in before, so each row binds only what it uses.
  const receivables: readonly (readonly unknown[])[] = [
    // Overdue and partly paid: contributes to both open and overdue totals.
    [RECEIVABLE_OVERDUE, TENANT_A, CUSTOMER_A, 'ext-1',
     AMOUNT.receivableOverdueMinor, AMOUNT.receivableOverduePaidMinor, OVERDUE_DUE, 'pending'],
    // Open and unpaid, due after AS_OF: open but not overdue.
    [RECEIVABLE_OPEN, TENANT_A, CUSTOMER_A, 'ext-2',
     AMOUNT.receivableOpenMinor, 0, OPEN_DUE, 'partial'],
    // Fully settled: must appear in record counts but in neither open total.
    [RECEIVABLE_SETTLED, TENANT_A, CUSTOMER_A, 'ext-3',
     AMOUNT.receivableSettledMinor, AMOUNT.receivableSettledMinor, OVERDUE_DUE, 'paid'],
    [RECEIVABLE_B, TENANT_B, CUSTOMER_B, 'ext-4',
     AMOUNT.receivableBMinor, 0, OVERDUE_DUE, 'pending'],
  ];
  for (const row of receivables) {
    await tx.execute(
      `INSERT INTO receivables
         (id, business_id, customer_id, transaction_id, amount_minor, paid_amount_minor,
          currency, due_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'INR', $7, $8)`,
      row,
    );
  }

  const payables: readonly (readonly unknown[])[] = [
    [PAYABLE_OPEN, TENANT_A, SUPPLIER_A, 'pay-1', AMOUNT.payableOpenMinor, 0, PAYABLE_DUE],
    [PAYABLE_B, TENANT_B, SUPPLIER_B, 'pay-2', AMOUNT.payableBMinor, 0, PAYABLE_DUE],
  ];
  for (const row of payables) {
    await tx.execute(
      `INSERT INTO payables
         (id, business_id, supplier_id, transaction_id, amount_minor, paid_amount_minor,
          currency, due_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'INR', $7, 'pending')`,
      row,
    );
  }
}

/** A recognised expense, an unrecognised one, and a recurring commitment. */
async function insertExpenses(tx: Executor): Promise<void> {
  await tx.execute(
    `INSERT INTO expenses
       (id, business_id, category, amount_minor, currency, description, status,
        expense_date, is_recurring, recurring_frequency, recurring_next_due_date, created_by)
     VALUES
       ('d4b10000-0000-4000-8000-000000001201', $1, 'rent',      $3, 'INR', 'Live rent',      'approved', '2026-01-05T00:00:00Z', false, NULL, NULL, $4),
       ('d4b10000-0000-4000-8000-000000001202', $1, 'utilities', $5, 'INR', 'Live power',     'paid',     '2026-01-06T00:00:00Z', false, NULL, NULL, $4),
       ('d4b10000-0000-4000-8000-000000001203', $1, 'marketing', $6, 'INR', 'Live pending',   'pending',  '2026-01-07T00:00:00Z', false, NULL, NULL, $4),
       ('d4b10000-0000-4000-8000-000000001204', $1, 'fees',      $7, 'INR', 'Live recurring', 'approved', '2026-01-01T00:00:00Z', true,  'monthly', '2026-02-01T00:00:00Z', $4),
       ('d4b10000-0000-4000-8000-000000001205', $2, 'rent',      $8, 'INR', 'Live tenant B',  'approved', '2026-01-05T00:00:00Z', false, NULL, NULL, $9)`,
    [
      TENANT_A,
      TENANT_B,
      AMOUNT.expenseRentMinor,
      USER_A,
      AMOUNT.expenseUtilitiesMinor,
      AMOUNT.expensePendingMinor,
      AMOUNT.expenseRecurringMinor,
      AMOUNT.expenseBRentMinor,
      USER_B,
    ],
  );
}

/**
 * Removes every fixture row, children first.
 *
 * `business_id` references use ON DELETE RESTRICT, so ordering matters. Ending
 * on the business rows also proves no fixture row can outlive its tenant.
 */
export async function clearLiveFixtures(db: DatabaseClient): Promise<void> {
  const both = [TENANT_A, TENANT_B];
  await db.transaction(async (tx) => {
    for (const statement of [
      `DELETE FROM action_logs WHERE business_id = ANY($1::uuid[])`,
      `DELETE FROM actions WHERE business_id = ANY($1::uuid[])`,
      `DELETE FROM scenarios WHERE business_id = ANY($1::uuid[])`,
      `DELETE FROM profit_leaks WHERE business_id = ANY($1::uuid[])`,
      `DELETE FROM cash_flow_forecasts WHERE business_id = ANY($1::uuid[])`,
      `DELETE FROM receivables WHERE business_id = ANY($1::uuid[])`,
      `DELETE FROM payables WHERE business_id = ANY($1::uuid[])`,
      `DELETE FROM transaction_items WHERE transaction_id IN
         (SELECT id FROM transactions WHERE business_id = ANY($1::uuid[]))`,
      `DELETE FROM transactions WHERE business_id = ANY($1::uuid[])`,
      `DELETE FROM expenses WHERE business_id = ANY($1::uuid[])`,
      `DELETE FROM inventory_movements WHERE business_id = ANY($1::uuid[])`,
      `DELETE FROM products WHERE business_id = ANY($1::uuid[])`,
      `DELETE FROM customers WHERE business_id = ANY($1::uuid[])`,
      `DELETE FROM suppliers WHERE business_id = ANY($1::uuid[])`,
      `DELETE FROM business_members WHERE business_id = ANY($1::uuid[])`,
      `DELETE FROM businesses WHERE id = ANY($1::uuid[])`,
    ]) {
      await tx.execute(statement, [both]);
    }
    await tx.execute(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
      [USER_A, USER_A_SECOND, USER_B],
    ]);
  });
}

/**
 * Confirms every column the intelligence repositories persist exists.
 *
 * Migration 0001 shipped without `profit_leaks.detail`, `scenarios.detail`,
 * `actions.detail` and `actions.currency`, so all three stores failed with
 * pgCode 42703. Static inspection could not catch that; executing the statements
 * did. This keeps the gap from reopening silently on a fresh database.
 */
export async function assertIntelligenceColumnsExist(db: DatabaseClient): Promise<void> {
  const rows = await db.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (
          ('profit_leaks', 'detail'),
          ('scenarios',    'detail'),
          ('actions',      'detail'),
          ('actions',      'currency')
        )`,
  );
  const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = [
    'profit_leaks.detail',
    'scenarios.detail',
    'actions.detail',
    'actions.currency',
  ].filter((column) => !present.has(column));

  if (missing.length > 0) {
    throw new Error(
      `The database is missing columns the intelligence repositories write to: ${missing.join(', ')}. ` +
        'Apply supabase/migrations/20261002000004_intelligence_detail_columns.sql first.',
    );
  }
}