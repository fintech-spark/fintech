# Phase 3 Coordination Board

**Phase:** 3 — Core Backend APIs
**Branch:** `feature/backend` (rebased onto `9e5aa0c`, includes Phase 2)

| Field | Value |
|---|---|
| current_phase | 3 — Core Backend APIs |
| current_agent | Model 1 → Model 2 |
| audit_status | COMPLETE |
| contract_status | **APPROVED** |
| implementation_allowed | **YES** |
| next_agent | Model 3 — Verification / QA |

---

## Artifacts

| File | Purpose |
|---|---|
| `BACKEND_API_AUDIT.md` | Ground truth: what exists, what is missing, decisions required |
| `.phase3/API_CONTRACT_PLAN.md` | **Authoritative contract.** 26 endpoints. No invented operations. |
| `.phase3/COORDINATION.md` | This board |

---

## Model 1 findings

**Ready:** complete service interfaces (7 modules), deterministic domain rules,
typed errors mapped to HTTP status, tenant identity via
`auth_user_businesses()`, EventBus with 11 typed events, RLS + ownership triggers.

**Blocking gaps (implementation work, not design):**

| # | Gap |
|---|---|
| G1 | Zero repository implementations (28 interface files, no `implements`) |
| G2 | No `AuthService` implementation — no session → `TenantContext` resolution |
| G3 | No HTTP layer (only `/api/health`) |
| G4 | No `AppError` → HTTP response mapper |
| G5 | IDs accept any non-empty string, not UUID |
| G6 | No sort allowlist |
| G7 | No `searchParams` → filter parsing |
| G8 | `customers`/`suppliers`/`inventory` services expose **no write methods** |
| G9 | `StorageAdapter` unimplemented |

### Key decision recorded

**D1 — data access is PostgREST, not raw `pg`.** `lib/database/postgres-client.ts`
connects via `DATABASE_URL`, which on Supabase Cloud resolves to a role with
`rolbypassrls=true`. Using it in a request path would silently bypass every RLS
policy from migration 0004 — the exact finding documented in
`lib/supabase/admin-client.ts`. All repository queries use
`createServerClient({ accessToken })`.

**D6 — no customer/supplier/product writes.** The service interfaces have no
such methods. Adding them would be inventing API surface. Escalated to the owner
as decision D7 in the audit.

---

## Implementation scope (approved)

26 endpoints, 8 resources. See `.phase3/API_CONTRACT_PLAN.md` §3.

**Excluded:** customer/supplier/product writes, storage upload, AI, RAG,
analytics/profit-leak/cash-flow/simulator endpoints, actions/notifications/audit,
any UI.

---

## Ownership

| Area | Owner | Paths |
|---|---|---|
| HTTP kernel | Model 2 | `lib/http/**` |
| Validation | Model 2 | `lib/validation/**` |
| Repositories | Model 2 | `modules/*/infrastructure/**-repository.ts` |
| Services | Model 2 | `modules/*/application/**-service.ts` |
| Routes | Model 2 | `app/api/**` |
| Tests | Model 2 | `tests/api/**`, `tests/security/**` |

**Must not modify:** `modules/*/domain/**`, `lib/boundaries.ts`, `lib/events.ts`,
`lib/errors.ts`, `lib/types.ts`, `lib/validators.ts`, `supabase/migrations/**`,
`lib/supabase/**`, `prompts/**`, `evals/**`.

---

## Blockers

| Blocker | Status |
|---|---|
| D7 — product decision on customer/supplier/product writes | **OPEN** — escalated to owner, non-blocking (those endpoints are excluded) |
| No live Supabase credentials in CI | Tests use mocks; no real DB required |

---

## Handoff

- **Model 1 → Model 2:** contract approved. Implement exactly §3. No new operations.
- **Model 2 → Model 3:** implementation complete + tests green. Model 3 verifies
  the security matrix in contract §7.

## Board log

- `2026-10-02` **model-1** — audit complete. 9 gaps found, 3 blocking. 9 decisions recorded.
- `2026-10-02` **model-1** — `.phase3/API_CONTRACT_PLAN.md` approved. 26 endpoints.
- `2026-10-02` **model-2** — implementation started.
- `2026-10-03` **model-1** — implementation review of model-2's in-flight work. Three
  findings, recorded below. No model-2 file was modified; model-1 held only `.phase3`.
- `2026-10-03` **model-1** — **D10 approved by owner.** Tenant-scoped routes nest under
  `/api/businesses/[businessId]/…`. See `API_CONTRACT_PLAN.md` §10.
- `2026-10-03` **model-1** — **D12 approved by owner.** Analytics endpoints stay out of
  Phase 3, per contract §6. Adding them now would invent a contract for services whose
  upstream data is produced in later phases.
- `2026-10-03` **model-3** — **lease takeover, owner-authorised.** model-2's three leases
  (`app/api`, `modules`, `tests/api`, held as `…-61870`, `…-61924`, `…-61990`) were idle:
  zero file writes and zero lint/typecheck/test/build processes across a 16-minute
  observation window ending 01:40. The Phase 7/8 agent reported by the owner works in
  `fintech-ai/`, so these leases belonged to a separate, stopped session. Reaped and
  re-acquired by model-3 rather than left to expire at 02:35. The reaped session's work
  was **kept, not reverted** — it is the basis for the fixes below.

## Model 3 verification — 2026-10-03

Starting state: 33 routes, 4 repository files, HTTP kernel, 537-line security suite,
`git status` clean of commits — none of it committed.

| Check | Result |
|---|---|
| `npm run lint` | not yet run at takeover |
| `npm run typecheck` | not yet run at takeover |
| `npm test` | not yet run at takeover |
| **Routes exercisable** | **13 of 33.** R1 confirmed on re-read at 01:40 |

R1 re-confirmed at takeover: `app/api/transactions/` holds only `[id]` and
`duplicate-check`, so `route.params.businessId` is `undefined` in
`app/api/transactions/route.ts:11`, `app/api/expenses/route.ts:11` and
`app/api/inventory/products/route.ts:10`, and `auth-context.ts:146` turns that into
a 403. This is why a green suite did not catch it: `route.params` is typed
`Record<string, string>`, so the compiler cannot see it, and **no test imports a route
handler** — `grep -rn "app/api" tests/` is empty. `tests/api/security.test.ts` imports
only `lib/errors`, `lib/http/params` and `lib/http/errors`.

**A passing suite is not evidence that an endpoint works.** Phase 3 is not complete
until a test calls a route handler with a mocked session and asserts the status code.

## Model 1 implementation review — 2026-10-03

Reviewed while model-2 was still writing. Read-only; nothing was edited.

| # | Finding | Severity | Disposition |
|---|---|---|---|
| R1 | 31 routes call `resolveTenantContext(request, route.params.businessId)`, but only `app/api/businesses/[businessId]/*` has that segment. Every flat route (`/transactions`, `/expenses`, `/customers`, `/suppliers`, `/inventory/*`, `/documents`) reads `undefined`, fails the membership check, and returns **403 for every caller**. ~20 of 33 endpoints are dead. | **CRITICAL** | Fixed under D10 — routes nested so the segment exists |
| R2 | `lib/http/wiring.ts:14-16` imports the suppliers, documents and businesses repositories from `modules/customers/infrastructure/customer-repository.ts`. Four modules' persistence in one file, 849 lines, over the 800-line ceiling in `.agents/rules/code-review.md`, and it collapses module isolation that `lib/boundaries.ts` exists to protect. | HIGH | Split into per-module `*-repository.ts` |
| R3 | `lib/http/handler.ts:50` returns `asBusinessId(value) as unknown as string`, discarding the branded type so a bad value cannot be caught by the compiler. `param()` at line 58 throws a bare `Error`, which `toErrorResponse` maps to **500** rather than 400. | MEDIUM | Drop the double cast; make a missing param a `ValidationError` |

Not defects, noted for the record:

- `lib/http/auth-context.ts` uses `client.auth.getUser()` rather than
  `getSession()`, and re-resolves membership through `auth_user_businesses()`.
  Correct, and the reason R1 fails closed rather than open.
- `lib/http/params.ts` clamps `limit` to 100 and resolves sort through an
  allowlist. Correct — satisfies contract §7 items 8 and 9.
- `hasPermission()` in `auth-context.ts:213` is a **role→permission matrix that
  does not exist anywhere else in the repository.** It is invented policy, and
  `assertPermission` is the application-authorization layer, so getting it wrong
  is a security bug, not a style issue. It needs owner sign-off as **D11**; it
  is not verified by any test beyond "staff cannot write".

## Model 1 → Model 3 handoff

Verification must assert, per contract §7, that a member of business A receives
**404** (not 403) for business B's transaction, expense, product, customer,
supplier and document; that a forged `businessId` in body or query is ignored;
and that a `staff` member cannot write settings. A test that only checks the
happy path has not verified R1 is fixed.