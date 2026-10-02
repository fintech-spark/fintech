import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATABASE_TABLES } from '@/database/schema';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');

async function readAllMigrations(): Promise<string> {
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const contents = await Promise.all(
    files.map((f) => readFile(join(MIGRATIONS_DIR, f), 'utf-8'))
  );
  return contents.join('\n\n');
}

describe('Database Schema — Migration File Integrity', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readAllMigrations();
  });

  it('contains CREATE TABLE for every table in DATABASE_TABLES', async () => {
    for (const tableName of Object.values(DATABASE_TABLES)) {
      const pattern = new RegExp(`CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?${tableName}\\s*\\(`, 'i');
      expect(sql).toMatch(pattern);
    }
  });

  it('creates exactly 26 domain tables plus _migrations', async () => {
    const createMatches = sql.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\(/gi) ?? [];
    expect(createMatches.length).toBeGreaterThanOrEqual(27);
  });
});

describe('Database Schema — Primary Keys', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readAllMigrations();
  });

  it('defines a uuid PRIMARY KEY on every domain table', async () => {
    const tableNames = Object.values(DATABASE_TABLES);
    for (const table of tableNames) {
      const tableSection = extractTableSection(sql, table);
      expect(tableSection).toMatch(/id\s+uuid\s+PRIMARY\s+KEY/i);
    }
  });
});

describe('Database Schema — Foreign Keys & Deletion Behavior', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readAllMigrations();
  });

  it('uses RESTRICT for core financial tables (no blind cascade)', async () => {
    // transactions must not cascade-delete with businesses
    const txSection = extractTableSection(sql, 'transactions');
    expect(txSection).toMatch(/business_id.*REFERENCES\s+businesses\(id\).*ON\s+DELETE\s+RESTRICT/i);

    // products must not cascade-delete with businesses
    const productSection = extractTableSection(sql, 'products');
    expect(productSection).toMatch(/business_id.*REFERENCES\s+businesses\(id\).*ON\s+DELETE\s+RESTRICT/i);

    // audit_logs must not cascade-delete with businesses (preserve audit trail)
    const auditSection = extractTableSection(sql, 'audit_logs');
    expect(auditSection).toMatch(/business_id.*REFERENCES\s+businesses\(id\).*ON\s+DELETE\s+RESTRICT/i);
  });

  it('uses CASCADE for derived/disposable tables', async () => {
    // transaction_items cascade with transactions
    const itemSection = extractTableSection(sql, 'transaction_items');
    expect(itemSection).toMatch(/transaction_id.*REFERENCES\s+transactions\(id\).*ON\s+DELETE\s+CASCADE/i);

    // chat_messages cascade with chat_sessions
    const msgSection = extractTableSection(sql, 'chat_messages');
    expect(msgSection).toMatch(/session_id.*REFERENCES\s+chat_sessions\(id\).*ON\s+DELETE\s+CASCADE/i);

    // action_logs cascade with actions
    const logSection = extractTableSection(sql, 'action_logs');
    expect(logSection).toMatch(/action_id.*REFERENCES\s+actions\(id\).*ON\s+DELETE\s+CASCADE/i);
  });

  it('uses SET NULL for optional references', async () => {
    // products.supplier_id SET NULL when supplier deleted
    const productSection = extractTableSection(sql, 'products');
    expect(productSection).toMatch(/supplier_id.*REFERENCES\s+suppliers\(id\).*ON\s+DELETE\s+SET\s+NULL/i);

    // actions.approved_by SET NULL when user deleted
    const actionSection = extractTableSection(sql, 'actions');
    expect(actionSection).toMatch(/approved_by.*REFERENCES\s+users\(id\).*ON\s+DELETE\s+SET\s+NULL/i);

    // audit_logs.user_id SET NULL when user deleted
    const auditSection = extractTableSection(sql, 'audit_logs');
    expect(auditSection).toMatch(/user_id.*REFERENCES\s+users\(id\).*ON\s+DELETE\s+SET\s+NULL/i);
  });
});

describe('Database Schema — CHECK Constraints', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readAllMigrations();
  });

  it('enforces transaction total invariant: total = subtotal - discount + tax', async () => {
    const section = extractTableSection(sql, 'transactions');
    expect(section).toMatch(/total_minor\s*=\s*subtotal_minor\s*-\s*discount_minor\s*\+\s*tax_minor/i);
  });

  it('enforces non-negative money amounts', async () => {
    const txSection = extractTableSection(sql, 'transactions');
    expect(txSection).toMatch(/subtotal_minor.*CHECK\s*\(\s*subtotal_minor\s*>=\s*0/i);

    const expenseSection = extractTableSection(sql, 'expenses');
    expect(expenseSection).toMatch(/amount_minor.*CHECK\s*\(\s*amount_minor\s*>=\s*0/i);
  });

  it('enforces paid_amount <= amount on receivables', async () => {
    const section = extractTableSection(sql, 'receivables');
    expect(section).toMatch(/paid_amount_minor\s*<=\s*amount_minor/i);
  });

  it('enforces paid_amount <= amount on payables', async () => {
    const section = extractTableSection(sql, 'payables');
    expect(section).toMatch(/paid_amount_minor\s*<=\s*amount_minor/i);
  });

  it('enforces recurring expense requires frequency and next due date', async () => {
    const section = extractTableSection(sql, 'expenses');
    expect(section).toMatch(/is_recurring.*recurring_frequency.*recurring_next_due_date/i);
  });

  it('enforces cash_flow_forecast period_end > period_start', async () => {
    const section = extractTableSection(sql, 'cash_flow_forecasts');
    expect(section).toMatch(/period_end\s*>\s*period_start/i);
  });

  it('enforces positive quantity on transaction_items', async () => {
    const section = extractTableSection(sql, 'transaction_items');
    expect(section).toMatch(/quantity.*CHECK\s*\(\s*quantity\s*>\s*0/i);
  });

  it('enforces positive file_size on documents', async () => {
    const section = extractTableSection(sql, 'documents');
    expect(section).toMatch(/file_size.*CHECK\s*\(\s*file_size\s*>\s*0/i);
  });
});

describe('Database Schema — Tenant Isolation Foundation', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readAllMigrations();
  });

  it('has business_id column on every business-owned table', async () => {
    const childTables = ['transaction_items', 'action_logs', 'chat_messages'];
    const tablesWithBusinessId = Object.values(DATABASE_TABLES).filter(
      (t) => t !== 'users' && t !== 'businesses' && !childTables.includes(t)
    );
    for (const table of tablesWithBusinessId) {
      const section = extractTableSection(sql, table);
      expect(section).toMatch(/business_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+businesses\(id\)/i);
    }
  });

  it('users table does NOT have business_id (users are cross-tenant)', async () => {
    const userSection = extractTableSection(sql, 'users');
    expect(userSection).not.toMatch(/business_id/i);
  });

  it('child tables inherit tenant isolation via parent foreign key', async () => {
    const itemSection = extractTableSection(sql, 'transaction_items');
    expect(itemSection).toMatch(/transaction_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+transactions\(id\)/i);

    const logSection = extractTableSection(sql, 'action_logs');
    expect(logSection).toMatch(/action_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+actions\(id\)/i);

    const msgSection = extractTableSection(sql, 'chat_messages');
    expect(msgSection).toMatch(/session_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+chat_sessions\(id\)/i);
  });
});

describe('Database Schema — UNIQUE Constraints', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readAllMigrations();
  });

  it('enforces unique business_member per (business, user)', async () => {
    const section = extractTableSection(sql, 'business_members');
    expect(section).toMatch(/UNIQUE\s*\(business_id,\s*user_id\)/i);
  });

  it('enforces unique product SKU per business', async () => {
    const section = extractTableSection(sql, 'products');
    expect(section).toMatch(/UNIQUE\s*\(business_id,\s*sku\)/i);
  });

  it('enforces unique supplier_pricing per (business, supplier, product)', async () => {
    const section = extractTableSection(sql, 'supplier_pricing');
    expect(section).toMatch(/UNIQUE\s*\(business_id,\s*supplier_id,\s*product_id\)/i);
  });

  it('enforces unique user email', async () => {
    const section = extractTableSection(sql, 'users');
    expect(section).toMatch(/UNIQUE\s*\(email\)/i);
  });
});

describe('Database Schema — Indexes & Idempotency', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readAllMigrations();
  });

  it('creates partial unique index for transaction idempotency', async () => {
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+idx_transactions_idempotency/i);
    expect(sql).toMatch(/WHERE\s+idempotency_key\s+IS\s+NOT\s+NULL/i);
  });

  it('creates partial unique index for expense idempotency', async () => {
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+idx_expenses_idempotency/i);
  });

  it('creates partial unique index for action idempotency', async () => {
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+idx_actions_idempotency/i);
  });

  it('creates partial unique index for document content_hash deduplication', async () => {
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+idx_documents_content_hash/i);
  });

  it('creates HNSW vector index for embeddings', async () => {
    expect(sql).toMatch(/USING\s+hnsw\s*\(embedding\s+vector_cosine_ops\)/i);
  });
});

describe('Database Schema — Triggers & Timestamps', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readAllMigrations();
  });

  it('defines set_updated_at() function', async () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+set_updated_at\(\)/i);
  });

  it('creates BEFORE UPDATE triggers for tables with updated_at', async () => {
    const tablesWithUpdatedAt = [
      'businesses', 'users', 'business_members',
      'suppliers', 'customers', 'products',
      'transactions', 'expenses',
      'receivables', 'payables',
      'documents', 'profit_leaks',
      'actions', 'notifications',
    ];
    for (const table of tablesWithUpdatedAt) {
      expect(sql).toMatch(new RegExp(`CREATE\\s+TRIGGER\\s+trg_${table}_updated_at`, 'i'));
    }
  });

  it('uses timestamptz with DEFAULT now() for creation timestamp on all tables', async () => {
    for (const table of Object.values(DATABASE_TABLES)) {
      const section = extractTableSection(sql, table);
      expect(section).toMatch(/timestamptz\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/i);
    }
  });
});

describe('Database Schema — Money Representation', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readAllMigrations();
  });

  it('uses bigint for all money columns (minor units)', async () => {
    const moneyColumns = [
      'subtotal_minor', 'discount_minor', 'tax_minor', 'total_minor',
      'amount_minor', 'cost_price_minor', 'selling_price_minor',
      'total_purchases_minor', 'outstanding_balance_minor', 'outstanding_payable_minor',
      'impact_minor', 'starting_cash_minor', 'ending_cash_minor',
    ];
    for (const col of moneyColumns) {
      expect(sql).toMatch(new RegExp(`${col}\\s+bigint`, 'i'));
    }
  });

  it('does not use float/double/real for any money column', async () => {
    const moneyColLines = sql.split('\n').filter((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('--') || trimmed.startsWith('CONSTRAINT') || trimmed.startsWith('CHECK')) {
        return false;
      }
      return /^\s*\w+_minor\s+/i.test(line);
    });
    expect(moneyColLines.length).toBeGreaterThan(0);
    for (const line of moneyColLines) {
      expect(line).toMatch(/bigint/i);
      expect(line).not.toMatch(/\b(float|double|real)\b/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Helper: extract the CREATE TABLE ... ); block for a given table name
// ---------------------------------------------------------------------------

function extractTableSection(sql: string, tableName: string): string {
  const startPattern = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${tableName}\\s*\\(`,
    'i'
  );
  const match = sql.match(startPattern);
  if (!match || match.index === undefined) {
    throw new Error(`Table ${tableName} not found in migrations`);
  }
  const startIndex = match.index + match[0].length;
  const rest = sql.slice(startIndex);
  const endMatch = rest.match(/\n\);/);
  if (!endMatch || endMatch.index === undefined) {
    throw new Error(`End of table ${tableName} not found in migrations`);
  }
  return rest.slice(0, endMatch.index);
}
