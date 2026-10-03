# Backend API Audit — Merchant Brain Phase 3

**Agent:** Model 1 (read-only audit)
**Branch:** `feature/backend` @ `9e5aa0c` (includes Phase 2)
**Purpose:** Establish ground truth before any API is written.

---

## 1. What already exists

### 1.1 A complete, precise service contract — READY

All 19 modules declare service interfaces. The seven Phase 3 modules have
**fully specified method signatures**. This is the contract. It was not
invented for Phase 3; it shipped in Phase 1.

| Module | Service interface | Repository interface |
|---|---|---|
| `auth` | 5 methods | — |
| `businesses` | 4 methods | 4 methods |
| `transactions` | 5 methods | 5 methods |
| `expenses` | 5 methods | 4 methods |
| `inventory` | 5 methods | 6 methods |
| `customers` | 5 methods | 5 methods |
| `suppliers` | 5 methods | 6 methods |
| `documents` | 6 methods | 5 methods + `StorageAdapter` |

Every repository method that touches tenant data takes `businessId` as its
first parameter. **This is the tenant-scoping seam.**

### 1.2 Complete domain rules — READY

Real, tested, deterministic logic already exists:

- `transactions/domain/rules.ts` — status transition table, `calculateItemTotal`,
  `validateTransactionTotal`, `isDuplicateCandidate`
- `inventory/domain/rules.ts` — `needsReorder`, `hasSufficientStock`,
  `calculateNewStock`, `calculateInventoryValue`, `calculateMarginBps`
- `businesses/domain/rules.ts` — `canManageSettings`, `canInviteMembers`,
  `isMemberActive`, `isBusinessOperational`
- `analytics`, `expenses`, `cash-flow`, `profit-leaks`, `simulator` — calculation rules

### 1.3 Typed errors — READY

`lib/errors.ts` maps 1:1 to the required HTTP categories:

| Class | code | status |
|---|---|---|
| `ValidationError` | `VALIDATION_ERROR` | 400 |
| `AuthenticationError` | `UNAUTHENTICATED` | 401 |
| `AuthorizationError` | `FORBIDDEN` | 403 |
| `NotFoundError` | `NOT_FOUND` | 404 |
| `ConflictError` | `CONFLICT` | 409 |
| `BusinessRuleError` | `BUSINESS_RULE_VIOLATION` | 422 |
| `DatabaseError` | `DATABASE_ERROR` | 500 |

Plus `wrapDatabaseError()`, `isUniqueViolationError()`,
`isForeignKeyViolationError()`. `toJSON()` is already a safe client shape.

### 1.4 Validation — PARTIAL

`lib/validators.ts` has branded-ID schemas, `currencyCodeSchema`, `moneySchema`,
`paginationParamsSchema` (limit capped at 100), `dateRangeSchema`.
**Gaps:** no `uuid` format enforcement (all IDs are `.min(1)`), no body schemas
per resource, no sort allowlist.

### 1.5 Tenant identity — READY (Phase 2)

- `TenantContext { businessId, userId, role, correlationId }`
- `auth_user_businesses()` → SETOF uuid, SECURITY DEFINER, `search_path=''`
- `auth_user_admin_businesses()`, `auth_user_owner_businesses()`
- `prevent_business_id_mutation()`, `prevent_parent_id_mutation()`,
  `prevent_membership_role_escalation()`, `prevent_users_email_mutation()`
- `createServerClient({ accessToken })` → RLS-enforced, `server-only`
- `createAdminClient({ bypassRowLevelSecurity: true })` → greppable, server-only

### 1.6 EventBus — READY

`lib/events.ts` exports 11 typed events including `TransactionCreatedEvent`,
`InventoryChangedEvent`, `PaymentRecordedEvent`, `ActionProposedEvent`.

---

## 2. Gaps

| # | Gap | Severity |
|---|---|---|
| G1 | **Zero repository implementations.** All 28 files are interfaces; no `implements`, no `.query()` outside `lib/database`. | Blocker |
| G2 | **No `AuthService` implementation.** No session → `TenantContext` resolution exists. | Blocker |
| G3 | **No HTTP layer.** Only `app/api/health/route.ts`. | Blocker |
| G4 | **No error → HTTP response mapper.** `toJSON()` exists but no route wrapper uses it. | High |
| G5 | **IDs accept any non-empty string**, not UUID. Malformed IDs pass validation. | High |
| G6 | **No sort allowlist.** `PaginationParams` has no sort field; adding one risks SQL injection via `ORDER BY`. | High |
| G7 | **No `Date`/query-param parsing helper.** `dateRangeSchema` exists but nothing wires `searchParams` → filters. | Medium |
| G8 | **No `create`/`save` for customers, suppliers, products.** Services expose only read methods. | Medium |
| G9 | **`StorageAdapter` has no implementation.** | Medium |

### 2.1 The G8 finding — important

Service interfaces for `customers`, `suppliers`, and `inventory` expose **no
create/update operations** — only `getById`, `list`, and aggregates.

Your brief lists "create / get / list / update" as candidates. **That would be
inventing API surface.** This audit records it as an explicit gap for a product
decision rather than implementing it.

Repository interfaces *do* have `save()`, but the service layer deliberately
exposes no write path. I will not add one.

---

## 3. Decisions required before implementation

| ID | Question | Proposed default |
|---|---|---|
| D1 | Data access: PostgREST (`createServerClient`) or raw SQL (`pg`)? | **PostgREST.** RLS is written against `auth.uid()`; the `pg` path uses `DATABASE_URL`, which on Supabase Cloud has `rolbypassrls=true` and would silently bypass every policy (documented in `lib/supabase/admin-client.ts`). |
| D2 | Where does `businessId` come from? | **Derived server-side** via `auth_user_businesses()`. Never from the request body. |
| D3 | Body-schema validation | New `lib/validation/*.ts` using the existing `lib/validators.ts` primitives |
| D4 | UUID enforcement | Tighten to `z.string().uuid()` in new schemas; do not mutate existing exports |
| D5 | Sort allowlist | Explicit per-resource allowlist constant |
| D6 | Writes for customers/suppliers/products | **Not implemented** — blocked on D7 |
| D7 | Product approval | Business writes not yet specified; needs owner decision |
| D8 | Events on write | Emit only where a typed event already exists |
| D9 | Response envelope | `{ data }` on success, `{ error }` from `toJSON()` |

---

## 4. Security posture for Phase 3

**Defense in depth, three layers:**

1. **RLS** (Phase 2) — `auth.uid()` → `business_members` → `business_id`
2. **Application authorization** — permission check per operation
3. **Ownership triggers** — `prevent_business_id_mutation()` etc.

**Non-negotiable rules for every route:**

- `businessId` is never read from client input.
- Every query goes through `createServerClient({ accessToken })`, never `createAdminClient`.
- Missing/invalid session → 401 before any DB work.
- Verified membership → 403 otherwise.
- Cross-tenant `id` → **404, not 403** (do not confirm existence).

---

## 5. Audit conclusion

The repository has everything needed for a contract-driven API layer. **No
architecture needs inventing.** The contract in `modules/*/application/service.ts`
is authoritative; Phase 3 implements it and nothing else.

Blocking items: **G1, G2, G3.** All are implementation work, not design work.