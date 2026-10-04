# Database Security Audit — Merchant Brain Phase 2

**Auditor:** Model 1 — Security Auditor
**Date:** 2026-10-02
**Branch:** `feat/database-security` (based on `origin/main` @ `f268ded`)
**Scope:** READ-ONLY audit. No implementation, no fixes, no policy changes.
**Verdict:** 🔴 **CRITICAL — the database is completely unprotected. Phase 2 must land RLS before any application code connects.**

---

## 1. Executive summary

Phase 1 delivered a well-structured schema: 27 tables, correct FK relationships,
defensive CHECK constraints, and a clean tenant model. **It delivered zero security.**

| Control | Expected | Actual |
|---|---|---|
| `ENABLE ROW LEVEL SECURITY` | 27 tables | **0** |
| `CREATE POLITY` / policies | per-table per-role | **0** |
| `GRANT` / `REVOKE` | least privilege | **0** |
| `SECURITY DEFINER` functions | none, or hardened | 0 (safe) |
| Storage buckets + policies | defined | **0** |
| Auth / session verification | implemented | **interface only** |
| Repository implementations | exist | **0** |

The single most important fact: **Supabase's default `public` schema grants
`ALL` on every table to `anon`, `authenticated`, and `service_role`.** Because
nothing revokes those grants and nothing enables RLS, **any unauthenticated
internet user who holds the project's anon key can read, insert, update, and
delete every row of every business** through the Supabase REST API (PostgREST).

The anon key is not secret — it is designed to be shipped to browsers. This is
not a theoretical risk.

---

## 2. Method

Inspected on disk, not assumed:

- `supabase/migrations/*.sql` — all 4 files, every statement
- `supabase/config.toml`, `supabase/seed.sql`
- `database/` (schema, rows, validation, index)
- `lib/database/` (client interface, postgres implementation)
- `lib/types.ts`, `lib/registry.ts`, `lib/errors.ts`, `lib/events.ts`
- `modules/auth/`, `modules/businesses/` and all 19 module barrels
- `app/api/health/route.ts`, `app/layout.tsx`
- `.env.example`, `.github/workflows/`
- Grepped the whole repo for: `ROW LEVEL SECURITY`, `CREATE POLICY`, `GRANT`,
  `REVOKE`, `SECURITY DEFINER`, `storage.buckets`, `createClient`,
  `service_role`, `.query(`, `.execute(`, `implements.*Repository`

---

## 3. Tenant model

```
users (global, auth-level)
  └─ business_members (business_id, user_id, role)   ← authorization join
       └─ businesses (tenant root)
            └─ 21 tables with direct business_id
                 └─ 3 child tables inheriting ownership via parent FK
```

- **Tenant root:** `businesses.id` (uuid)
- **Authorization join:** `business_members(business_id, user_id, role, status)`
- **Roles:** `owner`, `admin`, `manager`, `accountant`, `staff`
- **Context object:** `TenantContext { businessId, userId, role, correlationId }`
  (`lib/types.ts:52`) — carried through the application, never trusted from the client.

### Ownership representation — three tiers

| Tier | Tables | Count |
|---|---|---|
| **Direct `business_id`** | see §4 | 21 |
| **Indirect (inherit via parent FK)** | `transaction_items`, `action_logs`, `chat_messages` | 3 |
| **Tenant root / global / internal** | `businesses`, `users`, `_migrations` | 3 |

---

## 4. Table-by-table audit

Legend — **RLS:** is Row Level Security enabled · **Pol:** policies defined ·
**S/I/U/D:** SELECT / INSERT / UPDATE / DELETE access for `authenticated`

### Tier 1 — direct `business_id` (21 tables)

| Table | business_id | RLS | Pol | S | I | U | D | Cross-tenant attack | Required fix |
|---|---|---|---|---|---|---|---|---|---|
| `transactions` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read/alter any business's ledger | RLS + policies |
| `transaction_items` | ⚠️ via `transactions` | ❌ | ❌ | ALL | ALL | ALL | ALL | Insert lines onto another business's transaction | RLS via parent join |
| `expenses` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read/alter any business's expenses | RLS + policies |
| `products` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read/alter any business's catalog & stock | RLS + policies |
| `inventory_movements` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Forge stock movements | RLS + policies |
| `customers` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read/alter any business's customer PII | RLS + policies |
| `suppliers` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read/alter any business's suppliers | RLS + policies |
| `supplier_pricing` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read supplier pricing across tenants | RLS + policies |
| `receivables` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read/alter customer balances | RLS + policies |
| `payables` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read/alter supplier balances | RLS + policies |
| `documents` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read/alter uploaded documents | RLS + policies |
| `ingestion_jobs` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read pipeline state across tenants | RLS + policies |
| `document_extractions` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read extracted data across tenants | RLS + policies |
| `document_embeddings` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read vector chunks across tenants | RLS + policies |
| `profit_leaks` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read/alter intelligence findings | RLS + policies |
| `cash_flow_forecasts` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read/alter financial projections | RLS + policies |
| `scenarios` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read/alter simulations | RLS + policies |
| `actions` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Approve/execute another business's actions | RLS + policies |
| `action_logs` | ⚠️ via `actions` | ❌ | ❌ | ALL | ALL | ALL | ALL | Read another business's action audit trail | RLS via parent join |
| `notifications` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read/alter another business's inbox | RLS + policies |
| `audit_logs` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | **Tamper with the compliance audit trail** | RLS + append-only |
| `chat_sessions` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | Read another business's conversations | RLS + policies |
| `chat_messages` | ⚠️ via `chat_sessions` | ❌ | ❌ | ALL | ALL | ALL | ALL | Read another business's chat history | RLS via parent join |
| `business_members` | ✅ direct | ❌ | ❌ | ALL | ALL | ALL | ALL | **Escalate privileges / invite attacker** | RLS + role guard |

> Note: `audit_logs` and `business_members` are the highest-value targets.
> `audit_logs` is the compliance trail — it must become append-only.
> `business_members` is the authorization join — a write here is privilege escalation.

### Tier 3 — root / global / internal (3 tables)

| Table | RLS | Pol | Risk | Required fix |
|---|---|---|---|---|
| `businesses` | ❌ | ❌ | Tenant root readable/writable by all | RLS + policies |
| `users` | ❌ | ❌ | Global user table readable by all | RLS + policies |
| `_migrations` | ❌ | ❌ | Internal bookkeeping | Revoke from `anon`/`authenticated` |

---

## 5. Attack paths

### AP-1 — Unauthenticated cross-tenant read (CRITICAL)

```
Attacker (no account, holds public anon key)
  → GET https://<project>.supabase.co/rest/v1/transactions
  → PostgREST assumes role `authenticated` / `anon`
  → no RLS, no policy → full table scan
  → every business's transactions returned
```

**Impact:** complete loss of confidentiality for all merchant financial data.

### AP-2 — Cross-tenant write / delete (CRITICAL)

```
Attacker
  → DELETE /rest/v1/transactions?id=eq.<victim-uuid>
  → no RLS → row deleted
```

**Impact:** data destruction across all tenants.

### AP-3 — Cross-tenant insert with forged `business_id` (CRITICAL)

```
Attacker
  → POST /rest/v1/transactions  { "business_id": "<victim>", ... }
  → no RLS, no policy, FK only checks the business exists
  → attacker's row written into the victim's tenant
```

**Impact:** data poisoning, falsified ledger entries, corrupted analytics.

### AP-4 — Child-table injection via parent FK (HIGH)

`transaction_items`, `action_logs`, `chat_messages` have **no `business_id`**.
Their only ownership signal is the parent FK.

```
Attacker
  → POST /rest/v1/transaction_items  { "transaction_id": "<victim-tx>", ... }
  → FK is satisfied (parent exists)
  → no RLS → line item attached to a transaction they do not own
```

**Impact:** tampering with financial line items, audit trails, and chat history
without ever owning the parent row. This is the subtlest gap and the one most
likely to be missed by a naive "add `business_id` to every table" fix.

### AP-5 — Privilege escalation via `business_members` (CRITICAL)

```
Attacker (member of Business A with role 'staff')
  → PATCH /rest/v1/business_members?user_id=eq.<self>
  → { "role": "owner" }
  → no RLS → role escalated to owner
```

**Impact:** full tenant takeover. The authorization join is writable by everyone.

### AP-6 — Audit trail tampering (HIGH)

```
Attacker
  → DELETE /rest/v1/audit_logs?business_id=eq.<victim>
  → no RLS → compliance evidence destroyed
```

**Impact:** the audit module's core guarantee is void.

### AP-7 — Privileged operations without a service-role strategy (MEDIUM)

There is **no `SUPABASE_SERVICE_ROLE_KEY`** in `.env.example` and **no admin
client** in the codebase. Phase 2 will need privileged operations (admin
audit reads, cross-tenant support, background jobs). Without a defined
service-role pattern, the likely shortcut is to embed a privileged key in the
application — which would be a new vulnerability.

---

## 6. Detailed finding categories

### 6.1 Authentication vs authorization

| Layer | State |
|---|---|
| Authentication | **Superseded — implemented after this audit.** Session verification now lives in `lib/http/auth-context.ts` (`requireRequestContext`: cookie/Bearer extraction → `getUser()` JWT revalidation → `auth_user_businesses()` RPC). `AuthService` in `modules/auth` remains an interface with no implementing class. |
| Authorization | **Superseded — implemented after this audit.** `hasPermission(role, permission)` (`lib/http/auth-context.ts`) is enforced inside the seven PostgREST repositories and, since the Phase 4 hardening, via `assertPermission` on the analytics, cash-flow, profit-leak, simulator and AI chat routes. |
| Tenant context | **Superseded — implemented after this audit.** `resolveTenantContext` populates `TenantContext` from the route param re-validated against the DB-derived membership set; tenant identity is never taken from a request body or query. |
| DB-level auth | **Present.** `auth.uid()` is read by the `SECURITY DEFINER` membership helpers in migration 0004, with `search_path` pinned and `EXECUTE` revoked from `PUBLIC`. |

**Consequence for Phase 2:** RLS policies need a stable way to identify the
caller. In Supabase this is `auth.uid()` (from the verified JWT). Phase 2 must
establish the auth integration **before or alongside** RLS, because policies
cannot be written against a principal that does not exist yet.

### 6.2 RLS gaps

- RLS disabled on **27/27** tables.
- **0** policies.
- **0** `GRANT`/`REVOKE` — Supabase defaults apply, which are permissive.
- No `FORCE ROW LEVEL SECURITY` — table owners bypass RLS even once enabled.

### 6.3 Ownership mutation risks

| Field | Risk |
|---|---|
| `business_id` on Tier-1 tables | Mutable via UPDATE unless a policy blocks cross-tenant reassignment. A policy must prevent changing `business_id` to a tenant the caller does not belong to. |
| `transaction_items.transaction_id` | Reassigning a line item to another transaction must be blocked. |
| `action_logs.action_id` | Same. |
| `chat_messages.session_id` | Same. |
| `business_members.role` | Self-escalation (AP-5). |
| `business_members.status` | Self-removal to hide activity, or self-reinstatement. |
| `users.email` | Account takeover if mutable by non-owner. |

### 6.4 Privileged access risks

- No service-role key declared — **currently safe by omission**.
- No `SECURITY DEFINER` functions — **safe**.
- `set_updated_at()` and `gen_uuid()` are `SECURITY INVOKER` (default) — safe,
  but neither has `SET search_path`, which the Supabase linter flags and which
  is a hardening best practice.
- `scripts/migrate.mjs` and `scripts/seed.mjs` connect as the **Postgres
  superuser** via `DATABASE_URL`. Correct for migrations, but these scripts
  must never be exposed to non-admin callers.

### 6.5 RPC / function risks

Only two functions exist, both safe:

| Function | Security | `SET search_path` | Verdict |
|---|---|---|---|
| `set_updated_at()` | INVOKER | ❌ | Safe; harden |
| `gen_uuid()` | INVOKER | n/a (SQL) | Safe |

No `SECURITY DEFINER`, no `SECURITY INVOKER ... SET search_path = ''`.
Phase 2 should not introduce `SECURITY DEFINER` functions. If one is
unavoidable, it must set `search_path` explicitly and be reviewed line by line.

### 6.6 Storage risks

- **No buckets defined.** No `storage.buckets` INSERTs, no `storage.objects`
  policies.
- The `documents` module will need document storage. Without buckets and
  per-tenant storage policies, uploaded invoices/receipts would be world-readable.
- **Required:** one bucket (e.g. `documents`), private, with policies keyed on
  `business_id` parsed from the object path.

### 6.7 API / server action risks

| Surface | State |
|---|---|
| API routes | Only `GET /api/health` — unauthenticated, returns static JSON. **Safe.** |
| Server actions | None. |
| Middleware | None. |
| Auth helpers | Interface only. |

No injection or authorization risk exists today because there is no attack
surface. **The risk is that Phase 3+ will add routes against an unprotected
database.** RLS must land first.

### 6.8 SQL security risks

- **No SQL injection.** The only query execution path is `node-postgres` with
  parameterized queries (`lib/database/postgres-client.ts`). No string
  concatenation of user input into SQL was found.
- `pg.types.setTypeParser` overrides for int8/numeric/float are type-only and
  do not affect query construction.
- **Risk to preserve:** any future repository that builds dynamic `WHERE`
  clauses by string concatenation would introduce injection. Phase 2 must keep
  the parameterized-query discipline.

### 6.9 Child-table risks

The three child tables are the highest-risk items in the schema:

| Child | Parent | Ownership path | Why it is hard |
|---|---|---|---|
| `transaction_items` | `transactions` | `transaction_items.transaction_id → transactions.business_id` | Policy must join to parent; a `USING` clause on the child alone cannot see `business_id`. |
| `action_logs` | `actions` | `action_logs.action_id → actions.business_id` | Same. |
| `chat_messages` | `chat_sessions` | `chat_messages.session_id → chat_sessions.business_id` | Same. |

A correct policy for these requires a subquery or `EXISTS` against the parent,
e.g.:

```sql
-- shape only, NOT to be applied by this audit
CREATE POLICY ... ON transaction_items
  USING (EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.id = transaction_items.transaction_id
      AND t.business_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'business_id')::uuid
  ));
```

The exact claim key depends on the auth design Model 2 chooses.

---

## 7. Classification summary

| Classification | Count | Items |
|---|---|---|
| **CONFIRMED VULNERABILITY** | 27 | Every table: no RLS, no policies, default permissive grants |
| **CONFIRMED VULNERABILITY** | 3 | Child tables with no `business_id` and no parent-join policy |
| **CONFIRMED VULNERABILITY** | 1 | `business_members` writable by all → privilege escalation |
| **CONFIRMED VULNERABILITY** | 1 | `audit_logs` writable/deletable → evidence tampering |
| **POTENTIAL RISK** | 1 | No service-role strategy for privileged operations |
| **POTENTIAL RISK** | 1 | No storage buckets/policies for documents |
| **POTENTIAL RISK** | 1 | `set_updated_at()` lacks `SET search_path` |
| **POTENTIAL RISK** | 1 | `.env.example` `DATABASE_URL` names `merchant_brain`; local Supabase uses `postgres` |
| **SAFE / MITIGATED** | — | No `SECURITY DEFINER`; no SQL injection; no client-side DB access; no service-role key in code; `/api/health` is static |
| **UNKNOWN / NEEDS TESTING** | 1 | Exact Supabase default grants on this project (assumed permissive; must be verified with `\dp` in psql) |

---

## 8. Required Phase 2 deliverables

### 8.1 Tables requiring RLS (all 27)

Enable `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` on every
table in `public`, then add policies.

### 8.2 Policies required

For each Tier-1 table: `SELECT`, `INSERT`, `UPDATE`, `DELETE` policies scoped
to the caller's `business_id`, with role-based write restrictions.

For each Tier-2 (child) table: policies that resolve ownership through the
parent FK join.

For `business_members`: read-only for members; role changes restricted to
`owner`/`admin`; no self-escalation.

For `audit_logs`: `SELECT` for authorized roles; **no `INSERT`/`UPDATE`/`DELETE`
from `authenticated`** — writes must come only from a trusted service role.

For `_migrations`: revoke from `anon`/`authenticated`.

### 8.3 Ownership fields requiring protection

`business_id` (21 tables), `transaction_id`, `action_id`, `session_id`,
`business_members.role`, `business_members.status`, `users.email`.

### 8.4 Functions requiring review

`set_updated_at()` — add `SET search_path = ''` (or `public, extensions`).
No `SECURITY DEFINER` functions should be added.

### 8.5 Storage requirements

- Create a private `documents` bucket.
- Add `storage.objects` policies keyed on tenant prefix.
- Never use the service-role key from the browser.

### 8.6 API / server action requirements

- No new API route may query the database before RLS is live.
- Every route must resolve a verified `TenantContext` from the session — never
  from a client-supplied `business_id`.
- Add middleware to reject unauthenticated requests to non-public routes.

### 8.7 Tests required

- RLS enabled on every table (migration-level assertion).
- Cross-tenant SELECT/INSERT/UPDATE/DELETE all return zero rows / fail.
- Child-table cross-tenant access fails.
- `business_members` role self-escalation fails.
- `audit_logs` is append-only for `authenticated`.
- Policy performance: `EXPLAIN` shows index usage, not seq scans.

---

## 9. Handoff

### 9.1 Exact files Model 2 should modify

| File | Change |
|---|---|
| `supabase/migrations/20261002000004_rls_policies.sql` | **new** — enable RLS, create policies |
| `supabase/migrations/20261002000005_storage_policies.sql` | **new** — bucket + storage policies |
| `supabase/migrations/20261002000000_init_extensions.sql` | add `SET search_path` to `set_updated_at()` |
| `supabase/config.toml` | storage bucket config if needed |
| `lib/database/postgres-client.ts` | service-role client factory (separate from tenant client) |
| `modules/auth/application/service.ts` | implement against Supabase Auth |
| `lib/types.ts` | add auth claim → `TenantContext` mapping |

### 9.2 Files Model 2 must NOT modify

| File | Reason |
|---|---|
| `modules/*/domain/types.ts` | domain model is stable |
| `modules/*/domain/rules.ts` | business rules are stable |
| `lib/boundaries.ts` | module dependency graph is locked |
| `lib/events.ts` | event bus contract is stable |
| `app/**` | no frontend in Phase 2 |
| `prompts/**`, `evals/**` | no AI in Phase 2 |
| `tests/fixtures/**` | synthetic fixtures only |
| `.github/workflows/**` | CI is owned by another workstream |

### 9.3 Unresolved questions for Model 2

1. **Auth provider:** Supabase Auth (GoTrue) vs NextAuth/Auth.js? This
   determines whether policies key on `auth.uid()` or a custom claim.
2. **Claim shape:** does the JWT carry `business_id`, or must the policy join
   `business_members` on `auth.uid()`? The join is more correct (supports
   multi-business users) but slower.
3. **Multi-business users:** can a user belong to multiple businesses
   simultaneously? If yes, a single `business_id` claim is insufficient and the
   policy must accept a set.
4. **Service-role custody:** where does the privileged key live, and which
   operations are allowed to use it?
5. **Audit log writes:** which role/service is permitted to append?
6. **Storage path convention:** `<business_id>/<document_id>/<file>` vs
   `<document_id>/<file>` with metadata lookup.

### 9.4 Sequencing constraint

**RLS must be enabled before any application code connects to the database.**
The current codebase has no query paths, which is the last moment this work is
cheap. Once repositories exist, every new one is a potential cross-tenant hole.

---

## 10. What this audit did NOT do

- Did not implement RLS or policies.
- Did not modify migrations, SQL, or security behavior.
- Did not modify application authorization logic.
- Did not weaken or add tests.
- Did not add frontend, AI, or storage configuration.
- Did not connect to a live database to verify runtime grant state.

All findings are from static inspection of the repository on
`feat/database-security`.
