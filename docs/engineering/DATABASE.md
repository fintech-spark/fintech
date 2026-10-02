# Merchant Brain — Database Architecture

## Overview

Merchant Brain uses **PostgreSQL** (via **Supabase**) as its single primary database. The
database follows the Modular Monolith architecture: one database, one deployable, 19
isolated domain modules. No microservices, no separate databases per module.

The database foundation consists of:
- **26 domain tables** + 1 internal `_migrations` tracking table
- **SQL migrations** in `supabase/migrations/` (reproducible, version-controlled)
- **Concrete `PostgresDatabaseClient`** implementing the existing `DatabaseClient` /
  `TenantDatabaseClient` / `DatabaseTransaction` interfaces
- **Row type definitions** (`database/rows.ts`) for typed database access
- **Zod input validation schemas** (`database/validation.ts`) for boundary validation
- **Migration runner** (`scripts/migrate.mjs`) and **seed runner** (`scripts/seed.mjs`)

## Schema Ownership

Every business-owned table has a `business_id` column referencing `businesses(id)`. This
establishes a clear ownership path from every record to the tenant (business).

| Tier | Tables | Ownership |
|------|--------|-----------|
| Core | `businesses`, `users`, `business_members` | businesses owns members; users is cross-tenant |
| Financial | `transactions`, `transaction_items`, `expenses`, `products`, `inventory_movements` | All have `business_id → businesses(id)` |
| Partners | `customers`, `receivables`, `suppliers`, `payables`, `supplier_pricing` | All have `business_id → businesses(id)` |
| Documents | `documents`, `ingestion_jobs`, `document_extractions`, `document_embeddings` | All have `business_id → businesses(id)` |
| Analytics | `profit_leaks`, `cash_flow_forecasts`, `scenarios` | All have `business_id → businesses(id)` |
| Actions | `actions`, `action_logs` | actions has `business_id`; action_logs inherits via `action_id → actions(id)` |
| Comms | `chat_sessions`, `chat_messages`, `notifications`, `audit_logs` | All have `business_id → businesses(id)` |

The `users` table is the **only** business-owned table without `business_id`. Users are
cross-tenant entities — a single user may belong to multiple businesses via `business_members`.

## Migration Strategy

### File Structure

```
supabase/
├── config.toml           # Supabase project configuration
├── migrations/
│   ├── 20261002000000_init_extensions.sql   # Extensions + utility functions
│   ├── 20261002000001_core_tables.sql       # All 26 tables (DDL, FKs, CHECKs)
│   ├── 20261002000002_indexes.sql            # Secondary indexes
│   ├── 20261002000003_triggers.sql           # updated_at auto-trigger
│   └── ...
└── seed.sql               # Development seed data (not a migration)
```

### Running Migrations

```bash
# Apply all pending migrations
npm run db:migrate

# Check migration status
npm run db:migrate:status

# Apply seed data (development only)
npm run db:seed
```

The migration runner:
1. Reads all `.sql` files from `supabase/migrations/` in filename order
2. Tracks applied migrations in the `_migrations` table with SHA-256 checksums
3. Executes pending migrations inside individual transactions (BEGIN/COMMIT/ROLLBACK)
4. Fails fast on any migration error

### Supabase CLI (Alternative)

```bash
# Start local Supabase
supabase start

# Apply migrations
supabase db push

# Reset database (destructive — development only)
supabase db reset

# Apply seed data
supabase db seed
```

### Adding New Migrations

Create a new file in `supabase/migrations/` with a timestamp prefix:
```
supabase/migrations/YYYYMMDDHHMMSS_description.sql
```

The runner picks it up automatically on the next `npm run db:migrate`.

## Database Access Layer

### Architecture

```
Route Handler
    ↓
Domain Service (modules/*/application/service.ts)
    ↓
Repository (modules/*/infrastructure/repository.ts)
    ↓
DatabaseClient / TenantDatabaseClient (lib/database/)
    ↓
PostgreSQL via pg.Pool
```

### Interfaces

The existing abstract interfaces in `lib/database/client.ts` define the contract:

- **`DatabaseClient`** — root client with `query()`, `execute()`, `transaction()`, `forTenant()`
- **`TenantDatabaseClient`** — tenant-scoped client with `businessId` and same query surface
- **`DatabaseTransaction`** — scoped transaction handle with explicit `commit()` / `rollback()`

### Concrete Implementation

`lib/database/postgres-client.ts` provides:

- **`PostgresDatabaseClient`** — implements `DatabaseClient` using `pg.Pool`
- **`PostgresTenantDatabaseClient`** — implements `TenantDatabaseClient`, stores `businessId`
- **`PostgresTransaction`** — implements `DatabaseTransaction` with BEGIN/COMMIT/ROLLBACK
- **`createDatabaseClient(config?)`** — factory function
- **`getDatabaseClient()`** — singleton accessor (reads `DATABASE_URL` from env)

### Type Parser Configuration

The `pg` driver is configured to parse `bigint` (int8) and `numeric` as JavaScript
numbers. This is safe because Merchant Brain's minor-unit money values and
`numeric(20,3)` quantities are within `Number.MAX_SAFE_INTEGER`.

### Error Handling

All `pg` errors are wrapped in `DatabaseError` (extends `AppError`):
- Unique constraint violations → `DatabaseError` with safe message
- Foreign key violations → `DatabaseError` with safe message
- Other errors → `DatabaseError` with sanitized details (no SQL, no connection strings)

Helper functions: `isUniqueViolationError()`, `isForeignKeyViolationError()`,
`wrapDatabaseError()`.

## Money Representation

All monetary values are stored as **bigint minor units** (e.g., paise for INR, cents
for USD). The column naming convention is `<field>_minor`.

| Column | Type | Example |
|--------|------|---------|
| `total_minor` | bigint | 50000 = ₹500.00 |
| `amount_minor` | bigint | 2500000 = ₹25,000.00 |
| `cost_price_minor` | bigint | 8000 = ₹80.00 |
| `currency` | text + CHECK | 'INR' |

### CHECK Constraints

- All money columns have `CHECK (column >= 0)` (non-negative)
- `transactions`: `CHECK (total_minor = subtotal_minor - discount_minor + tax_minor)`
- `receivables` / `payables`: `CHECK (paid_amount_minor <= amount_minor)`
- No float/double/real types are used for any money column

### Application Layer

The `Money` type (`lib/types.ts`) enforces integer minor units at construction:
```typescript
createMoney(50000, 'INR')  // ₹500.00
createMoney(500.50, 'INR')  // throws TypeError — must be integer
```

## Transaction Strategy

### Database-Level Transactions

The `PostgresDatabaseClient.transaction()` method:
1. Acquires a connection from the pool
2. Executes `BEGIN`
3. Passes a `PostgresTransaction` handle to the callback
4. On success: executes `COMMIT`
5. On error: executes `ROLLBACK` (best-effort if already failed)
6. Releases the connection back to the pool

### Usage Pattern

```typescript
await dbClient.transaction(async (tx) => {
  const product = await tx.query<ProductRow>(
    'SELECT * FROM products WHERE business_id = $1 AND id = $2 FOR UPDATE',
    [businessId, productId]
  );

  const newStock = calculateNewStock(product[0].current_stock, quantity, 'sale');
  await tx.execute(
    'UPDATE products SET current_stock = $1, version = version + 1 WHERE id = $2',
    [newStock, productId]
  );
  await tx.execute(
    'INSERT INTO inventory_movements (...) VALUES (...)',
    [...]
  );
});
```

### Key Invariants

- Transactions are **serializable at the connection level** — one connection per
  transaction, no nested transactions
- `SELECT ... FOR UPDATE` is the recommended pattern for pessimistic locking
- The `version` column on mutable tables supports optimistic locking:
  `UPDATE ... SET version = version + 1 WHERE id = $1 AND version = $2`

## Concurrency Considerations

### Optimistic Locking

Tables vulnerable to concurrent updates have a `version` column (integer, default 1):
- `products`, `customers`, `suppliers`, `transactions`

Update pattern:
```sql
UPDATE products
SET current_stock = $1, version = version + 1
WHERE id = $2 AND version = $3
```
If 0 rows affected, another writer updated the record — the caller must retry.

### Pessimistic Locking

For critical stock operations, use `SELECT ... FOR UPDATE`:
```sql
SELECT * FROM products WHERE business_id = $1 AND id = $2 FOR UPDATE
```

### Append-Only Tables

These tables are never updated (only inserted), eliminating write contention:
- `inventory_movements`, `transaction_items`, `action_logs`, `chat_messages`,
  `audit_logs`, `document_embeddings`

### Unique Constraints

Composite unique indexes prevent duplicate concurrent writes:
- `business_members(business_id, user_id)` — can't join twice
- `products(business_id, sku)` — can't have duplicate SKU
- `supplier_pricing(business_id, supplier_id, product_id)` — can't have duplicate pricing

## Idempotency Strategy

### Idempotency Key Columns

Three tables have nullable `idempotency_key` columns with partial unique indexes:

| Table | Unique Index |
|-------|--------------|
| `transactions` | `(business_id, idempotency_key) WHERE idempotency_key IS NOT NULL` |
| `expenses` | `(business_id, idempotency_key) WHERE idempotency_key IS NOT NULL` |
| `actions` | `(business_id, idempotency_key) WHERE idempotency_key IS NOT NULL` |

### Deduplication

Documents have content-hash-based deduplication:
```sql
CREATE UNIQUE INDEX idx_documents_content_hash
ON documents (business_id, content_hash)
WHERE content_hash IS NOT NULL
```

### Usage

When a client provides an `idempotency_key`, the database enforces that only one
record can exist with that key per business. Retry attempts with the same key hit
the unique constraint and the application can return the existing record.

## Tenant Ownership Model

### How Tenancy Works

1. Every business-owned table has `business_id uuid NOT NULL REFERENCES businesses(id)
   ON DELETE RESTRICT`
2. The `TenantContext` (`lib/types.ts`) carries `businessId` through every service call
3. The `DatabaseClient.forTenant(businessId)` returns a `TenantDatabaseClient` that
   stores the `businessId` for repository use
4. Repository methods include `WHERE business_id = $1` using the tenant's `businessId`
5. The `users` table is the only exception — it's cross-tenant (a user may belong to
   multiple businesses via `business_members`)

### RLS (Phase 2)

Row-Level Security policies are **not implemented in Phase 1**. The tenant isolation
is enforced at the application level through:
- Explicit `business_id` in every query (via `TenantDatabaseClient`)
- Zod validation that rejects client-provided `businessId` (derived from `TenantContext`)
- Repository interfaces that accept `businessId` as a parameter

Phase 2 will add RLS policies as a defense-in-depth layer.

## Development Setup

### Prerequisites

- PostgreSQL 15+ (or Supabase CLI)
- Node.js 24.18+
- `DATABASE_URL` environment variable

### Quick Start (Supabase CLI)

```bash
# 1. Install Supabase CLI
npm install -g supabase

# 2. Start local Supabase
supabase start

# 3. Set DATABASE_URL in .env
#    (use the connection string from `supabase start` output)
echo 'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres' >> .env

# 4. Run migrations
npm run db:migrate

# 5. Seed development data
npm run db:seed
```

### Quick Start (Standalone PostgreSQL)

```bash
# 1. Create database
createdb merchant_brain

# 2. Set DATABASE_URL
echo 'DATABASE_URL=postgresql://localhost:5432/merchant_brain' >> .env

# 3. Run migrations
npm run db:migrate

# 4. Seed development data
npm run db:seed
```

### Verification

```bash
# Run database-specific tests
npm run test:db

# Run full verification suite
npm run verify:setup
```

## Deletion Behavior

Deletion is deliberately conservative. The principle: **financial and audit data
must never be silently cascade-deleted**.

| Behavior | Tables | Rationale |
|----------|--------|-----------|
| **RESTRICT** | All `business_id` FKs on financial/core tables, `transactions.created_by`, `expenses.created_by`, `audit_logs.business_id` | Prevents accidental data loss; caller must explicitly remove children first |
| **CASCADE** | `transaction_items → transactions`, `action_logs → actions`, `chat_messages → chat_sessions`, `document_embeddings → documents`, `ingestion_jobs → documents`, `document_extractions → documents` | Derived data that is meaningless without parent |
| **SET NULL** | `products.supplier_id → suppliers`, `actions.approved_by → users`, `audit_logs.user_id → users`, `transaction_items.product_id → products` | Optional references — preserve child record, nullify link |

## File Reference

| File | Purpose |
|------|---------|
| `supabase/migrations/*.sql` | Schema DDL (extensions, tables, indexes, triggers) |
| `supabase/seed.sql` | Development seed data |
| `supabase/config.toml` | Supabase project configuration |
| `database/schema.ts` | Table name constants (`DATABASE_TABLES`) |
| `database/rows.ts` | TypeScript row type definitions for all 26 tables |
| `database/validation.ts` | Zod input validation schemas |
| `database/index.ts` | Re-exports schema, rows, validation, client types |
| `lib/database/client.ts` | Abstract `DatabaseClient` / `TenantDatabaseClient` / `DatabaseTransaction` interfaces |
| `lib/database/postgres-client.ts` | Concrete PostgreSQL implementation |
| `lib/database/index.ts` | Re-exports interfaces + implementation |
| `lib/errors.ts` | `DatabaseError` + `wrapDatabaseError()` helper |
| `scripts/migrate.mjs` | Migration runner (applies pending SQL migrations) |
| `scripts/seed.mjs` | Seed runner (applies seed data) |
| `tests/database-schema.test.ts` | Schema integrity tests (validates SQL migrations structurally) |
| `tests/database-validation.test.ts` | Zod validation schema tests |
