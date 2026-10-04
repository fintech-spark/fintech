---
name: tenant-isolation-review
description: Verify that no code path can read or write another business's rows, and audit backend/data access for security. Use when reviewing the backend or database for security issues, adding or reviewing any API route, repository query, module service, RLS policy, migration, event subscriber, or AI tool; when touching lib/database/postgres-client.ts, lib/http/wiring.ts, lib/http/auth-context.ts, or anything calling .query()/.from(); and whenever a reviewer asks "can tenant A see tenant B's data?". Encodes the two-database-path trap, the hasPermission gap, and the RLS invariants for this repo.
---

# Tenant isolation review

Tenant isolation is the product's core safety property. This repo has **two database paths with
different enforcement mechanisms**, and mixing them up is the highest-risk mistake available here.

## The two paths

| Path | Client | Enforcement | Used by |
|---|---|---|---|
| `wireClient(db)` (`lib/http/wiring.ts:64`) | PostgREST + caller's JWT | **PostgreSQL RLS** — real, forced | transactions, expenses, inventory, customers, suppliers, businesses, documents |
| `wireIntelligence(businessId)` (`lib/http/wiring.ts:94`) | raw `pg` over `DATABASE_URL` | **application code only** — no RLS | analytics, cash-flow, profit-leaks, simulator, actions, notifications, business-brain |

`DATABASE_URL` resolves to a role with `rolbypassrls = true` on Supabase Cloud
(documented at `lib/supabase/admin-client.ts:6-9`). **Every RLS policy is inert on the `pg` path.**
There is no database backstop there — only your SQL.

## Procedure

1. **Classify the path.** If the code reaches `wireIntelligence`, `getDatabaseClient()`,
   `.forTenant()`, or `.query(`/`.execute(`, it is on the unprotected path. RLS will not save it.
2. **Confirm the tenant comes from the server.** `businessId` must be the route param re-validated
   against the DB, via `resolveTenantContext(request, params.businessId)`
   (`lib/http/auth-context.ts:138`). Never accept `businessId` from a body, query string, or form
   field. `ACTIVE_BUSINESS_COOKIE` is only ever an *intersection hint*
   (`lib/api/context.ts:111-122`), never an authority.
3. **Check the query actually filters.** On the `pg` path every statement needs an explicit
   `business_id = $n` predicate, in the `WHERE` **and** in any `JOIN`. Run:
   ```bash
   node .agents/skills/tenant-isolation-review/scripts/scan-tenant-safety.mjs
   ```
   It flags `.query(`/`.execute(` calls in `modules/` whose SQL lacks `business_id`.
4. **Check the role gate.** `hasPermission(role, permission)` (`lib/http/auth-context.ts:213`) is
   enforced **only** inside the seven PostgREST repositories. `grep -rl hasPermission modules/`
   returns them plus `auth-context.ts` and `auth/application/service.ts`. If you add a service on
   the `pg` path, you must call `hasPermission` yourself — nothing does it for you.
5. **For AI tools**, additionally confirm the tenant-key ban and SQL guard: tool schemas must not
   accept a tenant key (`FORBIDDEN_TENANT_KEYS`, `lib/ai/tools/schemas.ts:20-50`) and the query
   layer must refuse SQL without `business_id` (`modules/business-brain/infrastructure/tenant-query.ts:72-79`).

## Known gaps — do not treat as safe

- **No role gate on the 11 `wireIntelligence` routes** (analytics, cash-flow, profit-leaks,
  simulator, actions, notifications, ai/chat). A `staff` member can read all of them.
- **`action_logs` UPDATE/DELETE policies exist** (`20261002000004:327-345`) and the
  `business_id` immutability trigger list (`0004:128-136`) omits `action_logs`, while
  `20261002000011:98` added a `business_id` column. Audit rows can currently be relabelled across
  tenants or deleted.
- **`assertTenantSafe` is a substring heuristic** (`lib/database/postgres-client.ts:64-73`): a query
  passes if it contains `business_id`, `where id`, or `count(*)`. It is a typo net, not a guarantee.
- **`assertPermission` is exported but never called** — repositories call `hasPermission` directly.

## Gotchas

- `transactions`, `action_logs`, `chat_messages`, `transaction_items` have **no `business_id`** in
  `0001`; tenancy resolves through an `EXISTS` parent join. `action_logs.business_id` was added
  later by `0011`. Copying a policy pattern from a direct-tenant table to a child table breaks isolation.
- `FORCE ROW LEVEL SECURITY` is what closes the table-owner bypass. Any new table needs
  `ENABLE` **and** `FORCE`, or the owner role reads everything.
- `business_id` immutability is enforced by trigger, not by policy. A new tenant table must be
  added to the `tables[]` array in `0004:128-136` **in a new migration** — never by editing `0004`.
- Storage paths derive the tenant from `storage.foldername(name)[1]`
  (`20261002000005:37-40`), not from a column.
- A cross-tenant record id should surface as **404**, not 403 — a 403 confirms the row exists.

## Validation

```bash
npm run typecheck
npx vitest run tests/api tests/rag/tenant-guard.test.ts tests/ai-tools
LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  npx vitest run tests/database-security.test.ts
```

The live suite is **skipped without `LOCAL_DATABASE_URL`** (`tests/database-security.test.ts:9`).
It is the only place cross-tenant SELECT/INSERT/UPDATE/DELETE denial is actually proven — always
run it before claiming isolation is verified.

## References

- `references/rls-catalog.md` — table-by-table policy map and tenancy resolution
- Read `.agents/rules/security.md` for the standing project security policy.
