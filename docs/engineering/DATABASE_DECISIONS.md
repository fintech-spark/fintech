# Merchant Brain — Database Decisions & Tradeoffs

This document records important architectural decisions made during Phase 1
(Database Foundation) and the tradeoffs involved.

## Decision 1: PostgreSQL with pg (node-postgres) — No ORM

**Decision:** Use the `pg` (node-postgres) driver directly, without an ORM
(Prisma, Drizzle, Knex, etc.).

**Rationale:**
- The existing `DatabaseClient` interface is designed for raw SQL with positional
  parameters (`$1, $2`). An ORM would introduce a translation layer that conflicts
  with this design.
- Raw SQL gives full control over query optimization, constraint naming, and
  PostgreSQL-specific features (pgvector, partial indexes, CHECK constraints).
- The Modular Monolith's repository pattern already abstracts data access —
  repositories write the SQL, services call repository methods.

**Tradeoff:**
- No automatic schema-to-type generation (Prisma/Drizzle generate types from
  schema). Row types are manually maintained in `database/rows.ts`.
- No query builder for dynamic queries. Filter composition requires string
  concatenation (carefully parameterized).
- Migration tooling is custom rather than using a battle-tested ORM migration
  system.

**Mitigation:** Row types are validated by tests. The migration runner is simple
and well-tested. If type generation becomes a pain point, `kysely` (a type-safe
SQL builder, not an ORM) could be introduced without changing the architecture.

---

## Decision 2: bigint Minor Units for Money — Not numeric/decimal

**Decision:** Store all monetary values as `bigint` with `_minor` suffix
(e.g., `total_minor`, `amount_minor`), representing minor units (paise for INR,
cents for USD).

**Rationale:**
- The domain `Money` type already requires `amount: number` to be an integer
  (minor units). The database must enforce the same invariant.
- `bigint` is exact integer arithmetic — no floating-point drift, no rounding
  ambiguity.
- `bigint` supports values up to ~9.2 × 10^18, which is more than sufficient
  for financial data.
- The application layer's `createMoney()` already enforces integer-only at
  construction time.

**Tradeoff:**
- `bigint` returns as string by default in `pg`. We configure a type parser
  (`pg.types.setTypeParser(20, ...)`) to convert to JavaScript number. This is
  safe because our minor-unit values are within `Number.MAX_SAFE_INTEGER`
  (9 × 10^15, i.e., ~90 billion in major units — far beyond any realistic
  single-transaction amount).
- Money is stored as two columns (amount + currency) rather than a single
  composite type. This is more verbose but more queryable and indexable.

**Alternative considered:** PostgreSQL `numeric(20,3)` — rejected because it
allows fractional values and doesn't enforce integer-only, which conflicts with
the domain model's invariant. Used `numeric(20,3)` for quantities (which can be
fractional, e.g., 1.5 kg) but not for money.

---

## Decision 3: CHECK Constraints Instead of PostgreSQL ENUMs

**Decision:** Use `text` columns with `CHECK (column IN (...))` constraints
instead of PostgreSQL `CREATE TYPE ... AS ENUM` for all enum-like values.

**Rationale:**
- PostgreSQL ENUMs are immutable — adding a value requires `ALTER TYPE ADD VALUE`
  which is a DDL operation that may need exclusive locks.
- CHECK constraints are more flexible — values can be added/removed in a
  migration without type management overhead.
- CHECK constraints work identically with partial indexes and query planning.
- The error messages for CHECK violations are clear and include the constraint
  name.

**Tradeoff:**
- CHECK constraints are slightly less efficient than ENUMs for storage (ENUM
  uses 4 bytes; text uses variable bytes). For a financial application, this
  difference is negligible.
- No referential integrity for enum values across tables (an ENUM ensures the
  same set of values everywhere). In practice, each table's CHECK is
  independently maintained.

---

## Decision 4: Deletion Behavior — RESTRICT by Default, CASCADE for Derived Data

**Decision:** All foreign keys to `businesses(id)` use `ON DELETE RESTRICT`.
Derived/disposable tables use `ON DELETE CASCADE`. Optional references use
`ON DELETE SET NULL`.

**Rationale:**
- Financial data (transactions, expenses, products) must never be silently
  deleted. A business with financial history should not be removable without
  explicit data cleanup.
- Audit logs must survive business deletion for compliance — `RESTRICT` on
  `audit_logs.business_id` forces explicit handling.
- Derived data (transaction items, action logs, chat messages) is meaningless
  without its parent — `CASCADE` is appropriate.
- Optional references (supplier on product, approver on action) should not
  block deletion of the referenced entity — `SET NULL` preserves the child
  record.

**Tradeoff:**
- Deletion of a business is a multi-step process (must delete children first).
  This is intentional — it prevents accidental data loss.
- No soft-delete pattern (is_deleted flag). This would add complexity; Phase 2
  can introduce soft-delete if the product requires it.

---

## Decision 5: Explicit Tenant Scoping — No Implicit RLS (Phase 1)

**Decision:** Tenant isolation is enforced at the application layer through
explicit `business_id` in every query. Row-Level Security (RLS) policies are
deferred to Phase 2.

**Rationale:**
- The existing repository interfaces already accept `businessId` as a parameter
  (e.g., `findById(businessId, id)`). This is the intended tenancy boundary.
- The `TenantDatabaseClient` stores `businessId` for repositories to use —
  consistent with the existing design.
- RLS is a defense-in-depth layer, not the primary isolation mechanism. Adding
  it now without the application layer being correct first would create a false
  sense of security.
- Phase 1 focuses on schema correctness; RLS policies are a security enforcement
  concern (Phase 2 scope).

**Tradeoff:**
- A bug in a repository (forgetting `WHERE business_id = $1`) could leak data
  across tenants. This is mitigated by:
  1. Zod validation rejecting client-provided `businessId` (derived from
     `TenantContext`)
  2. Repository interfaces that mandate `businessId` as a parameter
  3. Architecture tests that enforce module boundaries
- RLS in Phase 2 will add a database-level safety net.

---

## Decision 6: Custom Migration Runner — Not Supabase CLI-Only

**Decision:** Ship a custom Node.js migration runner (`scripts/migrate.mjs`)
alongside the Supabase CLI-compatible migration files.

**Rationale:**
- The Supabase CLI is not installed in CI. The custom runner allows migrations
  to run in any PostgreSQL environment with just `DATABASE_URL` and `node`.
- The migration files are standard SQL in `supabase/migrations/` — fully
  compatible with `supabase db push` when the CLI is available.
- The runner is ~100 lines of simple, auditable code — no hidden magic.

**Tradeoff:**
- Two ways to run migrations (custom runner + Supabase CLI) could diverge.
  Mitigated by both reading from the same `supabase/migrations/` directory.
- The custom runner doesn't support rollback migrations. This is acceptable —
  forward-only migrations are the industry standard and the runner tracks
  checksums to detect tampering.

---

## Decision 7: Partial Unique Indexes for Idempotency

**Decision:** Use PostgreSQL partial unique indexes
(`CREATE UNIQUE INDEX ... WHERE idempotency_key IS NOT NULL`) for idempotency
rather than a separate idempotency records table.

**Rationale:**
- A single column + partial index is simpler than a join table.
- PostgreSQL's NULL-distinct behavior for unique indexes means records without
  an idempotency key don't conflict with each other.
- The check is atomic at the database level — no race condition between
  "check if exists" and "insert".

**Tradeoff:**
- The idempotency key is stored on the record itself rather than in a separate
  audit table. This means the key is visible to anyone who queries the table.
  If idempotency keys contain sensitive data, this could be a concern. In
  practice, idempotency keys are UUIDs or opaque client-generated strings.

---

## Decision 8: Optimistic Locking via `version` Column

**Decision:** Add an integer `version` column (default 1, CHECK >= 1) to
tables vulnerable to concurrent updates: `products`, `customers`, `suppliers`,
`transactions`.

**Rationale:**
- Optimistic locking is non-blocking — no `SELECT FOR UPDATE` needed for
  normal reads. Writers check the version on update and increment it.
- If two writers update the same record concurrently, one gets 0 rows affected
  (version mismatch) and must retry.
- Simpler than explicit advisory locks or table-level locks.

**Tradeoff:**
- Requires the application to handle retry on version conflict. This is
  standard in optimistic locking patterns.
- Doesn't prevent the "lost update" problem at the application level if the
  retry logic is missing. Repository implementations must include
  `AND version = $N` in UPDATE statements.

---

## Decision 9: Vector(1536) Dimension for Embeddings

**Decision:** Use `vector(1536)` for the `document_embeddings.embedding` column.

**Rationale:**
- 1536 is the dimension for OpenAI's `text-embedding-3-small` model and similar
  popular embedding models.
- The pgvector extension is already enabled in the initial migration.
- An HNSW index with `vector_cosine_ops` is created for fast similarity search.

**Tradeoff:**
- If a different embedding model is selected (e.g., Google's 768-dim), the
  dimension must be changed via a new migration. This is a straightforward
  `ALTER TABLE` + `DROP/CREATE INDEX` operation.
- The embedding column is nullable — records can exist before embeddings are
  computed.

---

## Decision 10: Flattened Nested Domain Objects

**Decision:** Flatten `BusinessProfile`, `BusinessSettings`, `RecurringExpenseConfig`,
and other nested domain objects into their parent table's columns rather than
using separate tables or JSONB.

**Rationale:**
- These nested objects have 1:1 relationships with their parent. Separate
  tables would add unnecessary JOINs for every query.
- JSONB would prevent column-level CHECK constraints and indexing.
- Flattened columns are individually nullable, queryable, and constraint-able.

**Tradeoff:**
- More columns in the parent table — slightly more verbose schema.
- The mapping from flat columns to nested domain objects happens in the
  repository layer (e.g., `display_name`, `industry`, `address` → `BusinessProfile`).

---

## Decision 11: No DatabaseError Subclasses for Specific Violations

**Decision:** Use a single `DatabaseError` class with `isUniqueViolationError()`
and `isForeignKeyViolationError()` helper functions rather than separate
`UniqueViolationError` and `ForeignKeyViolationError` subclasses.

**Rationale:**
- The error type is determined by the PostgreSQL error code (23505, 23503),
  not by the application. Checking the code is more reliable than relying on
  `instanceof` after the error is wrapped.
- Helper functions let the caller decide how to handle specific violations
  without importing multiple error classes.

**Tradeoff:**
- Less type-safe than subclasses — the caller must remember to call the helper
  rather than using `instanceof`. If this becomes a pain point, subclasses
  can be added later without breaking changes.
