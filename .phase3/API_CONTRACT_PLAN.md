# Phase 3 — API Contract Plan

**Status:** APPROVED for implementation
**Authority:** This plan implements the service interfaces already shipped in
`modules/*/application/service.ts`. It introduces **no new business operations**.

---

## 1. Core rules

1. **No invented endpoints.** Every route maps 1:1 to a method on an existing
   service interface.
2. **`businessId` is never client-supplied.** Derived server-side from the
   verified session via `auth_user_businesses()`.
3. **All queries use `createServerClient({ accessToken })`** — RLS-enforced.
   Never `createAdminClient` in a request path.
4. **Cross-tenant access returns 404**, never 403 (do not confirm existence).
5. **Every mutation is validated by Zod before any DB call.**
6. **Money is integer minor units** via `createMoney()`.
7. **Errors** are `AppError` subclasses mapped by one shared handler.

---

## 2. Request pipeline

```
Request
  → read session cookie → accessToken          (401 if absent/invalid)
  → resolve memberships via auth_user_businesses()
  → businessId ∈ memberships?                  (403 if not)
  → validate params + body (Zod)               (400)
  → build TenantContext
  → service method (authorizes via permission)
  → domain rules (deterministic)
  → repository (tenant-scoped query)
  → PostgREST under RLS
  → { data } | error handler → status
```

---

## 3. Endpoints

### 3.1 Session

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/auth/session` | required | Returns user + list of authorized business ids. The only way a client learns a valid `businessId`. |
| `GET` | `/api/businesses` | required | Businesses the caller is an active member of. |

### 3.2 Business

| Method | Path | Permission | Service method |
|---|---|---|---|
| `GET` | `/api/businesses/current` | `settings:read` | `getById(ctx)` |
| `GET` | `/api/businesses/current/members` | `settings:read` | `getMembers(ctx)` |
| `PATCH` | `/api/businesses/current/profile` | `settings:write` | `updateProfile(ctx, profile)` |
| `PATCH` | `/api/businesses/current/settings` | `settings:write` | `updateSettings(ctx, settings)` |

`settings:write` additionally requires `canManageSettings(role)`.

### 3.3 Transactions

| Method | Path | Permission | Service method |
|---|---|---|---|
| `POST` | `/api/transactions` | `transactions:write` | `create(ctx, input)` |
| `GET` | `/api/transactions` | `transactions:read` | `list(ctx, filters)` |
| `GET` | `/api/transactions/[id]` | `transactions:read` | `getById(ctx, id)` |
| `PATCH` | `/api/transactions/[id]/status` | `transactions:write` | `updateStatus(ctx, id, status)` |
| `GET` | `/api/transactions/duplicate-check` | `transactions:read` | `checkDuplicate(ctx, input)` |

Query params: `page`, `limit` (≤100), `type`, `status`, `counterpartyId`,
`from`, `to`. Sort allowlist: `transactionDate`, `createdAt`, `total`.

Rules: status transitions validated by `canTransitionTo` (422 on illegal
transition). `POST` honors `idempotencyKey` → replay returns the original
transaction (200) instead of creating a duplicate (409 on key reuse with a
different payload).

### 3.4 Expenses

| Method | Path | Permission | Service method |
|---|---|---|---|
| `POST` | `/api/expenses` | `expenses:write` | `create(ctx, input)` |
| `GET` | `/api/expenses` | `expenses:read` | `list(ctx, filters)` |
| `GET` | `/api/expenses/[id]` | `expenses:read` | `getById(ctx, id)` |
| `POST` | `/api/expenses/[id]/approve` | `expenses:write` | `approve(ctx, id)` |

Query params: `page`, `limit`, `category`, `status`, `from`, `to`.

### 3.5 Inventory (read + movement)

| Method | Path | Permission | Service method |
|---|---|---|---|
| `GET` | `/api/inventory/products` | `inventory:read` | `listProducts(ctx, filters)` |
| `GET` | `/api/inventory/products/[id]` | `inventory:read` | `getProduct(ctx, id)` |
| `GET` | `/api/inventory/low-stock` | `inventory:read` | `getLowStockProducts(ctx)` |
| `GET` | `/api/inventory/value` | `inventory:read` | `getInventoryValue(ctx)` |
| `POST` | `/api/inventory/movements` | `inventory:write` | `recordMovement(ctx, input)` |

Query params: `page`, `limit`, `status`, `category`, `lowStockOnly`, `search`.

`recordMovement` runs inside a DB transaction with `SELECT ... FOR UPDATE` on
the product row, then `calculateNewStock`. Negative resulting stock is rejected
(422). This is the concurrency-critical endpoint.

### 3.6 Customers (read-only — see §6)

| Method | Path | Permission | Service method |
|---|---|---|---|
| `GET` | `/api/customers` | `customers:read` | `list(ctx, filters)` |
| `GET` | `/api/customers/[id]` | `customers:read` | `getById(ctx, id)` |
| `GET` | `/api/customers/[id]/balance` | `customers:read` | `getBalance(ctx, id)` |
| `GET` | `/api/customers/receivables` | `customers:read` | `getReceivables(ctx, filters)` |
| `GET` | `/api/customers/receivables/totals` | `customers:read` | `getTotalReceivables(ctx)` |

### 3.7 Suppliers (read-only — see §6)

| Method | Path | Permission | Service method |
|---|---|---|---|
| `GET` | `/api/suppliers` | `suppliers:read` | `list(ctx, filters)` |
| `GET` | `/api/suppliers/[id]` | `suppliers:read` | `getById(ctx, id)` |
| `GET` | `/api/suppliers/[id]/pricing` | `suppliers:read` | `getPricing(ctx, supplierId)` |
| `GET` | `/api/suppliers/payables` | `suppliers:read` | `getPayables(ctx, filters)` |
| `GET` | `/api/suppliers/payables/totals` | `suppliers:read` | `getTotalPayables(ctx)` |

### 3.8 Documents (metadata only — no AI)

| Method | Path | Permission | Service method |
|---|---|---|---|
| `POST` | `/api/documents` | `documents:write` | `upload(ctx, input)` |
| `GET` | `/api/documents` | `documents:read` | `list(ctx, filters)` |
| `GET` | `/api/documents/[id]` | `documents:read` | `getById(ctx, id)` |
| `PATCH` | `/api/documents/[id]/status` | `documents:write` | `updateStatus(ctx, id, status, reason?)` |
| `POST` | `/api/documents/[id]/approve` | `documents:write` | `approve(ctx, id)` |
| `POST` | `/api/documents/[id]/reject` | `documents:write` | `reject(ctx, id, reason)` |

No extraction, no RAG, no embeddings. Binary storage is out of scope for this
phase (`StorageAdapter` is unimplemented — see §6).

---

## 4. Error contract

| Condition | Class | Status |
|---|---|---|
| No/invalid session | `AuthenticationError` | 401 |
| Valid session, not a member | `AuthorizationError` | 403 |
| Missing permission | `AuthorizationError` | 403 |
| Zod failure | `ValidationError` | 400 |
| Not found **or cross-tenant** | `NotFoundError` | 404 |
| Idempotency conflict / unique violation | `ConflictError` | 409 |
| Illegal status transition, negative stock | `BusinessRuleError` | 422 |
| Anything else | `DatabaseError` | 500 |

Response bodies never include SQL, stack traces, credentials, or provider internals.

---

## 5. Idempotency

Only where retry-sensitivity is real:

| Endpoint | Key | Behavior |
|---|---|---|
| `POST /api/transactions` | `idempotencyKey` in body | Replay → 200 + original |
| `POST /api/expenses` | `idempotencyKey` in body | Replay → 200 + original |
| `POST /api/inventory/movements` | `referenceId` + `referenceType` | Replay → 200 + original movement |

No general-purpose idempotency middleware.

---

## 6. Explicitly NOT in this phase

| Not implemented | Why |
|---|---|
| Customer / supplier / product **create & update** | Service interfaces expose no write methods. Adding them would invent API. **Needs product decision (D7).** |
| `StorageAdapter` upload/download | Interface exists, no implementation, no storage bucket in dev. Document metadata is created with an explicit `storagePath`. |
| AI extraction, RAG, embeddings | Phase 5+ |
| Analytics / profit-leaks / cash-flow / simulator endpoints | Service interfaces declare reads over data produced by later phases |
| `actions`, `notifications`, `audit`, `business-brain` | Phase 6+ |
| Any UI | Phase 8+ |

---

## 7. Required tests

**Security (must all fail safely):**
1. Business A reading Business B's transaction / expense / product / customer / supplier / document → 404
2. Forged `businessId` in body or query → ignored, request scoped to session tenant
3. Missing session → 401
4. Valid session, non-member business → 403
5. Privilege escalation (`staff` → settings write) → 403
6. Malformed UUID → 400
7. SQL-injection payloads in id / search / sort → no execution, 400 or empty result
8. `limit=9999` → clamped to 100
9. Sort field not in allowlist → 400
10. Cross-tenant `inventory_movements` insert → rejected

**Behavioral:**
- Status transition matrix (legal + illegal)
- Item total / transaction total arithmetic
- Pagination, filtering, sorting
- Idempotent replay
- Concurrent stock mutation (no lost update, no negative stock)
- Typed error mapping for every class
- Module boundary tests

---

## 8. File ownership

| Area | Files |
|---|---|
| Auth/context | `lib/http/auth-context.ts` (new) |
| HTTP kernel | `lib/http/errors.ts`, `lib/http/handler.ts`, `lib/http/params.ts` (new) |
| Validation | `lib/validation/*.ts` (new) |
| Repositories | `modules/*/infrastructure/*-repository.ts` (new) |
| Services | `modules/*/application/*-service.ts` (new) |
| Routes | `app/api/**` (new) |
| Tests | `tests/api/**`, `tests/security/**` (new) |

Must not modify: `modules/*/domain/**`, `lib/boundaries.ts`, `lib/events.ts`,
`lib/errors.ts`, `lib/types.ts`, `lib/validators.ts`, `supabase/migrations/**`,
`lib/supabase/**`, `prompts/**`, `evals/**`.

---

## 9. Approved scope

**26 endpoints** across 8 resources, backed by the existing service interfaces,
served through RLS-enforced PostgREST, with tenant context derived server-side.