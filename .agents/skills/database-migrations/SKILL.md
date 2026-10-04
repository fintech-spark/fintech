---
name: database-migrations
description: Add or review a PostgreSQL migration in supabase/migrations/ safely. Use when changing schema, adding a table/column/index/constraint, touching RLS policies, adding or altering a SECURITY DEFINER function or trigger, fixing a database drift finding, or when db:migrate fails, reports drift, or a migration has been applied out of band. Covers the checksum-drift gate, FORCE RLS requirements, search_path pinning, and the non-re-runnable early migrations.
---

# Database migrations

Applies pending SQL from `supabase/migrations/` in filename order, one transaction per file,
recording a sha256 in `_migrations`. Twelve migrations exist (`20261002000000` … `20261002000011`).

## Never edit an applied migration

`scripts/migrate.mjs` verifies every applied migration against the file on disk before running
anything (`findDrift`). It **blocks** on an edited or deleted applied migration and only warns for
rows whose recorded checksum is not a sha256.

Three rows are stamped `manual-cloud-apply` — applied through the Supabase SQL editor, so their
real content was never hashed. They are unverifiable by design and will never match. Do not
"fix" them by editing the file.

To change schema, always **append** a new migration named
`YYYYMMDDHHMMSS_short_description.sql` (14-digit timestamp prefix, matching the existing series).

## Commands

```bash
npm run db:migrate:status    # what is applied, drifted, or pending — read-only
npm run db:migrate           # apply pending
npm run db:seed              # synthetic seed data
npm run test:db              # static schema + validation tests (no DB needed)
LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  npm run test:db:live       # live RLS/DDL tests against the local stack
```

`DATABASE_URL` and `.env`/`.env.local` are loaded automatically by the runner. Never hardcode a
connection string.

## Writing a new migration

1. `npm run db:migrate:status` first — confirm the baseline.
2. Re-runnable is preferred. Early migrations (`0001`, `0002`, `0003`, `0004`, `0006`) are **not**
   re-runnable: bare `CREATE TABLE`, `CREATE INDEX`, `CREATE TRIGGER`, and a `DO` block that
   attaches triggers without dropping first. New migrations must use
   `IF NOT EXISTS` / `IF EXISTS` / `DROP ... IF EXISTS` so a partially applied run can be retried.
3. Every new table needs, in the same migration:
   - `business_id uuid NOT NULL REFERENCES businesses(id)` for tenant data
   - `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`
   - four policies (SELECT/INSERT/UPDATE/DELETE) built on
     `business_id IN (SELECT public.auth_user_businesses())`
   - the table added to the `business_id` immutability trigger array
4. Money columns are `bigint` minor units with a `CHECK`; never `float`/`numeric` for money and
   never `timestamptz` without a default. `tests/database-schema.test.ts` asserts both.
5. Wrap DDL + its data backfill in one transaction — the runner already does this per file.

## SECURITY DEFINER functions

- Pin `SET search_path = ''`. Every privileged function in this repo does except
  `match_document_embeddings` (`20261002000010:133`, widened to `public, extensions` — a known
  weakening). Unqualified names then resolve against a writable schema and `pg_temp` is searched
  first.
- If the body needs the vector operator, qualify it explicitly: `OPERATOR(extensions.<=>)`, then
  restore `search_path = ''`.
- `REVOKE ALL ... FROM PUBLIC` and grant only to `authenticated`.
- **Never accept a user-id parameter.** The subject must come from `auth.uid()`. A
  `SECURITY DEFINER` function taking a user id is a privilege-escalation primitive.
- Note: `REVOKE EXECUTE` on a *trigger* function does nothing — triggers fire regardless of
  `EXECUTE` privileges. Those revokes (`0007:95-98`, `0008:77-78`) are cosmetic.

## Gotchas

- `database/schema.ts` (`DATABASE_TABLES`) and `database/rows.ts` must be updated in the same
  change as the SQL, or they drift. `rows.ts` is **already drifted**: `ActionLogRow` still declares
  a `status` column that `0011` dropped, and five row types omit columns added by `0010`/`0011`.
- Adding a module without adding it to `MODULE_DEPENDENCIES` in `lib/boundaries.ts` silently
  quarantines it — see the `module-architecture` skill.
- `document_embeddings.embedding` is `vector(1536)`; changing the embedding model requires a
  migration, because a wrong-width vector is rejected by Postgres.
- The HNSW index (`0002:117`) is **not** partial, so unembedded rows are indexed even though
  `0010:12-13` implies otherwise.
- Migrations `0009` onward contain **assertion gates** that raise if an invariant regressed
  (RLS+FORCE present, `audit_logs` append-only, `_migrations` revoked, bucket private). A failing
  assertion means an earlier invariant broke — read it as a diagnosis, not an obstacle.

## Validation

```bash
npm run db:migrate:status                     # must show no drift, no unexpected pending
npm run test:db
npm run typecheck && npm test
LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  npx vitest run tests/database-security.test.ts
```

## References

- `references/schema-map.md` — table groups, tenancy resolution, and the child-table exceptions
