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