# Merchant Brain — Database Security Architecture

## Phase 2 — Implemented

- Migration `20261002000004_rls_tenant_isolation.sql` — 107 RLS policies across 26 tables; ownership-immunity triggers; SECURITY DEFINER membership helpers (`auth_user_businesses`, `auth_user_admin_businesses`) pinned with `search_path = ''`.
- Migration `20261002000005_storage_security.sql` — private `merchant-files` bucket with folder-scoped RLS (first segment = business_id).
- Migration `20261002000006_security_audit_adjustments.sql` (Model 2) — audit_logs append-only, `_migrations` revoked from API roles, `auth_user_owner_businesses()` + role escalation guard, `users.email` immutable.
- Migration `20261002000007_runtime_role_safety.sql` (Model 3) — asserts anon/authenticated have no bypassrls; revokes schema CREATE from them; pins function grants.
- Migration `20261002000008_redteam_fixes.sql` (Model 3) — M3-001 (fixed broken `prevent_parent_id_mutation` via `to_jsonb()`), M3-002 (fixed admin INSERT owner escalation).
- Migration `20261002000009_agent2_redteam.sql` — cross-tenant RLS defense, IDOR hardening, and table level security checks.
- Migration `20261002000010_rag_provenance.sql` — RAG document provenance tracking and chunk store schema extensions.
- Migration `20261002000011_intelligence_detail_columns.sql` — `details JSONB DEFAULT '{}'::jsonb NOT NULL` on `profit_leaks`, `cash_flow_forecasts`, `scenarios`, and `actions`.
- Migration `20261002000012_audit_immutability_and_rag_search_path.sql` — `prevent_audit_log_mutation()` trigger enforcing strict append-only immutability (UPDATE and DELETE blocked) + pinned `search_path = public, pg_catalog` on `match_document_embeddings`.

## RLS Strategy

Deny-by-default: every tenant-sensitive table has `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`. No `USING (true)` policies exist on tenant data (verified live, 103 policies, zero `true`). Child tables use `EXISTS` on parent (`transaction_items` → `transactions`, `action_logs` → `actions`, etc.).

## Role Hierarchy

- `anon` / `authenticated`: user-facing. RLS applies. `auth.uid()` resolves from JWT claims set per request by `lib/supabase/server-client.ts`.
- `merchant_app`: trialled in draft 0006 but removed — could not be fully provisioned because schema `auth` grants are owned by `supabase_admin` and cannot be granted by project migrations. Instead, server-side tenant access runs as `authenticated` with verified JWT.
- `service_role`: privileged backend. `rolbypassrls = true`. Only reachable through `lib/supabase/admin-client.ts`; requires `bypassRowLevelSecurity: true`; blocked by `server-only`; key must not be in `NEXT_PUBLIC_*`; audited live (all 5 cross-tenant attacks blocked when role changed from postgres bypass to RLS-enforced).

## Security Tests

- `tests/database-security.test.ts` — 21 DB-level RLS boundary tests (local Supabase required; not run in CI without `LOCAL_DATABASE_URL`).
- `tests/supabase-client-boundary.test.ts` — pure unit tests for client privilege boundary (no DB needed).
- `tests/verify-fixes.mjs` — red-team reproduction of M3-001 / M3-002 with regression checks.

## Known Limitations / Remaining Risks

- `DATABASE_URL` (cloud pooler) connects as `postgres` → `rolbypassrls = true`. A privileged database client (`lib/supabase/admin-client.ts`) exists but is never used for tenant data. The existing `PostgresDatabaseClient` should be guarded with `assertTenantSafe()` (recommended, not yet merged to avoid interfering with Phase 1 architecture).
- `_migrations` table has no RLS (internal, owner-only expected).
- Storage path convention relies on first-folder naming; same-business users can access each other's files within the folder. Per-user subfolder policy not enforced at DB layer.
- No rate limiting / egress timeouts at this layer.

## Verified States (Model 3, live DB evidence)

- Phase 2 RLS policies: 103 policies, 26 tables, 0 `USING (true)`.
- Cross-tenant SELECT / INSERT / UPDATE / DELETE with `postgres` (bypass): ALL 5 EXPLOITED (documented in `.phase2/COORDINATION.md`, evidence preserved).
- Same attacks with `merchant_app` (NOBYPASSRLS): ALL 5 BLOCKED; positive controls (own-tenant insert/read) pass.
- Fix M3-001 reproduced + fixed: `users UPDATE` broken with old trigger; works after `to_jsonb()` fix.
- Fix M3-002 reproduced + fixed: admin could INSERT `role='owner'`; blocked after INSERT guard.
