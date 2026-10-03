# Tenant Isolation & Database Security Findings

**Owner:** Agent 2 (Security) · **Branch:** `feat/database-security`
**Audit date:** 2026-10-03 · **Scope:** migrations `0000`–`0009`, RLS, storage,
privileges, functions, `search_path`, audit integrity.

---

## 1. Security findings register

| ID | Category | Severity | Component | Attack | Status |
|---|---|---|---|---|---|
| SEC-2026-001 | Authorization | **MEDIUM** | `businesses` INSERT policy | Any JWT holder creates unlimited tenant rows (unbounded growth / permanent DoS; no quota exists anywhere) | **FIXED** — `20261002000009` |
| SEC-2026-002 | Least privilege | **LOW** | `auth_user_*_businesses()` | `anon` could call the membership resolver; returns empty for a null `auth.uid()` so not exploitable, but an unnecessary surface | **FIXED** — `20261002000009` |
| SEC-2026-003 | Integrity | **LOW** | Schema invariants | No assertion that RLS/FORCE, audit append-only, `_migrations` revoke and bucket privacy survive future migrations | **FIXED** — `20261002000009` |

No CRITICAL or HIGH findings. The Phase 2 foundation is sound; see §2.

---

## 2. What was verified as already correct

This is the majority of the surface, and it should not be "fixed" again.

| Control | Evidence |
|---|---|
| RLS + **FORCE** on all 21 tenant-sensitive tables | `20261002000004` §4 DO block |
| Symmetric `USING` **and** `WITH CHECK` on every writable policy | `20261002000004` §8 |
| Child tables resolve tenancy by `EXISTS` join to parent, not a local column | `transaction_items`, `action_logs`, `chat_messages` |
| Ownership cannot be transferred | `prevent_business_id_mutation()` + `prevent_parent_id_mutation()` triggers |
| Role escalation blocked | `prevent_membership_role_escalation()` |
| `users` locked to `auth.uid()`; no DELETE policy | `20261002000004` §5 |
| `audit_logs` append-only for app roles | `20261002000006` drops INSERT/UPDATE/DELETE |
| `_migrations` revoked from `anon`, `authenticated` | `20261002000006` |
| All 11 functions pin `SET search_path` | verified across all migrations |
| All 3 `SECURITY DEFINER` helpers `REVOKE … FROM PUBLIC` | `0004`, `0006`, `0007` |
| Storage bucket `public = false`, 4 tenant-prefixed policies | `20261002000005` |
| All 12 dynamic-SQL sites use `format('%I')` over hardcoded arrays | no `%s` injection surface |

**Runtime-role note (documented, not a defect):** migration `0007` explains that
a separate least-privilege `NOLOGIN` role was trialled and removed because
`GRANT USAGE ON SCHEMA auth` cannot be issued from this project's migration role.
User-facing queries therefore run as `authenticated` with the caller's JWT
claims. This is fail-closed and deliberate; it is not an oversight.

---

## 3. SEC-2026-001 in detail

**Vulnerable policy** (migration `0004`):

```sql
CREATE POLICY businesses_insert_authenticated ON public.businesses
  FOR INSERT TO authenticated
  WITH CHECK (true);
```

`WITH CHECK (true)` constrains nothing. Any valid Supabase JWT could insert
unlimited `businesses` rows.

**Impact**

1. **Unbounded growth / DoS.** No quota exists in any migration. One token can
   exhaust table space and degrade the service for every tenant.
2. **Orphaned tenant roots are permanent.** No garbage-collection job exists in
   this repository, so the cost never recovers.
3. **No compensating control.** Phase 3's `POST /api/businesses` does not exist,
   so the database is the only enforcement point available today.

**Fix** — a tenant root may only be created by a user who already administers it:

```sql
CREATE POLICY businesses_insert_owner_only ON public.businesses
  FOR INSERT TO authenticated
  WITH CHECK (id IN (SELECT public.auth_user_admin_businesses()));
```

Onboarding becomes a two-step transaction: create the row, then insert the owner
`business_members` row. **Agent 1 must implement it that way.** If a user must
bootstrap their first tenant, that requires a purpose-built `SECURITY DEFINER`
bootstrap function with its own audit trail — not a permissive policy.

A fixed numeric cap was deliberately **not** chosen: that is a product decision
this audit cannot make, and it would penalise legitimate growth.

---

## 4. Regression coverage

`tests/agent2-redteam.test.ts` — 29 cases asserting on migration SQL text.

**Why SQL text and not a live database:** CI has no Postgres and no Supabase
instance. `tests/database-security.test.ts` (29 cases) already covers behaviour
against a live database for operators who have one. This suite guarantees a
future migration cannot silently *weaken* a control.

**Mutation-tested.** Each of these was verified to fail when the control is
removed, then restored:

| Mutation | Test that caught it |
|---|---|
| Re-introduce `WITH CHECK (true)` | `no longer grants an unconditional INSERT on businesses` |
| Remove the `anon` REVOKE | `revokes EXECUTE from anon for every membership helper` |
| Add an `audit_logs` DELETE policy | `keeps audit_logs append-only for application roles` |

A test that cannot fail is not a test.

---

## 5. Known limitations

1. **No live-database verification was performed.** No Postgres or Supabase
   instance was reachable from this audit. Findings are from static analysis of
   the migration SQL. `supabase db reset` against a local instance remains the
   outstanding confirmation step.
2. **`supabase/config.toml` has `[analytics] enabled = false`** — set during
   Phase 5 so the local stack would start on a constrained machine. It is a
   local-dev convenience only and has no production effect.
3. **`service_role` has `BYPASSRLS` by design** in Supabase. It is reachable
   only through the server-only admin client, which requires an explicit
   `{ bypassRowLevelSecurity: true }` acknowledgement. Reviewed and accepted.
4. **Business-creation onboarding flow is now Agent 1's responsibility.** If
   Agent 1 implements it as a single unaudited insert, SEC-2026-001 reopens.

---

## 6. Cross-agent findings (not fixed here)

These were identified while reviewing other branches. They are recorded for the
owning agent and were **not** modified, per branch ownership.

| Branch | Finding | Severity |
|---|---|---|
| `feature/ai` | `lib/errors.ts` leaked raw pg driver messages into API responses — **FIXED** in `f561811` during an earlier pass | HIGH (resolved) |
| `feature/ai` | `modules/validation` (158 lines, deterministic checks) has **no tests**; the 11 adversarial fixtures in `evals/validation/` are unreferenced | MEDIUM |
| `feature/ai` | No concrete `AIProviderAdapter` implementation existed, so extraction's provider port had nothing behind it | HIGH |
| `feature/ai` | `lib/ai/model-config.ts` omits `embedding` from `modelRoles`; `lib/ai/providers/types.ts` includes it | LOW |
| `feature/backend` | Customers/suppliers/documents/businesses services all live inside one `customers/infrastructure/` file — a structural smell, not a security defect | LOW |