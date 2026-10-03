# API rules

No product API contracts are approved yet. These rules apply when routes are designed; do not invent endpoints to make a feature appear complete.

Every future endpoint must:

1. Validate params, query, headers, and body with Zod at the boundary.
2. Authenticate protected routes before reading or mutating data.
3. Authorize the verified user against the requested tenant, resource, and action.
4. Enforce request size, pagination, upload, timeout, concurrency, and rate limits.
5. Use idempotency keys for retried mutations and action execution.
6. Validate uploads using `docs/security/FILE_SECURITY.md` and never trust client MIME/filenames.
7. Sanitize inputs where they enter HTML, logs, templates, SQL, shell, URLs, or provider requests.
8. Return a consistent safe error shape with a public code, human message, and correlation ID. Never expose stack traces, SQL, provider payloads, secrets, or tenant data.
9. Set appropriate cache, content type, CORS, CSRF, and security headers for the route.
10. Keep secrets and provider clients server-side. Do not leak them through serialization, logs, error messages, or `NEXT_PUBLIC_` variables.
11. Record audit events for authentication, authorization failures, data access, exports, prepared actions, and executed actions without raw sensitive payloads.
12. Add unit/integration tests for valid input, invalid input, unauthenticated access, unauthorized access, tenant isolation, retries, timeouts, and provider failures.

## Error shape (future convention)

```json
{
  "error": {
    "code": "stable_public_code",
    "message": "Safe user-facing message",
    "requestId": "correlation-id"
  }
}
```

The exact route names, fields, status codes, pagination, and auth mechanism must be approved with product and security owners before implementation.

---

## Phase 4 hardening — rules established by implementation

The rules above were aspirational until Phase 4. These are now enforced in code
and pinned by tests, and each exists because its absence produced a defect.

### Tenant resolution

Business identity comes from `resolveTenantContext(request, route.params.businessId)`,
which validates membership against `auth_user_businesses()` — a `SECURITY DEFINER`
function that takes no user-id argument, so the membership set is not forgeable.
No route reads a tenant from a body, query string, or header.

Every `[businessId]` route calls it. A route that does not is a finding.

### Authorization floors

`hasPermission(role, permission)` is the single authority. Two permissions were
defined in the matrix but never checked anywhere, which left them decorative:

| Permission | Grants | Enforced on |
| --- | --- | --- |
| `settings:read` | owner, admin | `GET /businesses/:id`, `GET /businesses/:id/members` |
| `analytics:read` | owner, admin, manager, accountant | reserved for Agent 4's analytics routes |

`settings:read` exists because the business record carries PAN and GSTIN. Those
are tax identifiers; membership alone is not authorisation to read them. The
member roster is administrative for the same reason.

Adding a method to a service without a permission check is the defect this table
prevents. `DefaultBusinessService` now routes every guarded method through one
private `require()` helper so a new method has a single obvious place to add it.

### Bounded pagination

`parsePagination` clamps `limit` to 100 **and** `page` to 10,000. Clamping only
the limit left `?page=1000000000` producing a billion-row OFFSET that Postgres
must walk before returning anything.

OFFSET is inherently O(offset), so this is a denial-of-service guard, not a
performance fix. Cursor pagination remains the right answer for large ledgers and
is follow-up work.

### Bounded whole-set aggregates

Six endpoints reduce a tenant's entire table in JavaScript: inventory
valuation, receivable totals, payable totals, low stock, the membership roster,
and supplier pricing. They are bounded by `lib/bounded-scan.ts`.

Two rules, both learned the hard way:

1. **Overflow throws. It never returns a partial total.** A merchant shown a
   valuation computed from half their stock cannot tell it is wrong — the same
   failure mode as a hardcoded zero.
2. **Every limit must stay below `POSTGREST_MAX_ROWS` (1000).** PostgREST clamps
   every response to `max-rows`, so a limit above 1000 is unenforceable: the
   driver asks for 50,000 rows, the server returns 1,000, and the overflow check
   sees `1000 <= 50,000` and passes. An earlier version of this file used
   five-figure limits and would have shipped silently wrong money. The invariant
   is asserted in `tests/api/hardening.test.ts`.

Raising a limit requires raising `max_rows` in `supabase/config.toml` **and** the
hosted project's API settings. The proper long-term fix is to move these
aggregates into SQL — a view or a `SECURITY DEFINER` function — which belongs with
whoever owns the schema.

### No fabricated data

`getBalance` previously returned a hardcoded `overdue: 0`, which is
indistinguishable from a computed zero in the response. It now derives the figure
from the receivables ledger, because `customers.outstanding_balance_minor` is a
lifetime total with no notion of due date.

Where a figure genuinely cannot be computed, the contract returns `null` or a
`*Available: false` flag. Never a plausible constant.

### Line-item references are tenant-checked

`transaction_items` has no `business_id` column and its `product_id` foreign key
is global, so both the FK and the RLS policy (which inspects only the parent
transaction) accept a product owned by another business. `POST /transactions`
verifies every `productId` against the caller's tenant first.

### Error mapping

| Condition | Class | Status |
| --- | --- | --- |
| Unique violation (23505) | `ConflictError` | 409 |
| Foreign-key violation (23503) | `ValidationError` | 400 |
| Unrecognised driver failure | `DatabaseError` | 500 |

A unique violation was previously a 500, which told the client the server was
broken when it had sent something that already exists — and left `ConflictError`,
which exists for precisely this, unused in the entire codebase. Constraint names
are never forwarded: they leak schema detail.

### Status codes

Create routes return **201**. `withApi` defaults to 200 and accepts an explicit
`status`. One exception: `POST /inventory/movements` returns **200** when the
request replayed an already-recorded reference, because nothing was created and
the response body is the original movement.

### Search terms are literal

`parseSearch` escapes `%`, `_` and `\` because its output is interpolated into a
`%term%` pattern. Without escaping, `?search=%25` matches every row. This is not
SQL injection — PostgREST binds the value — but it is a caller-controlled pattern
with an unbounded cost profile.

Use `parseFilterValue` for equality filters. It trims and length-caps without
escaping; using `parseSearch` for an `.eq()` comparison corrupts legitimate
values (a category named `5_kg_bags` would arrive escaped and match nothing).

### Rejection reasons

`PATCH /documents/:id/status` cannot reject without a reason, and cannot carry a
reason with any other status. Both directions matter: without the first the
generic status route bypasses the rule `POST /documents/:id/reject` exists to
enforce; without the second a reason is persisted onto an approved document and
returned as `metadata.rejectionReason`, and because both states are terminal the
mistake can never be corrected.

## Known gaps

Recorded rather than hidden. Each is a real absence, not a decision.

- **No audit trail.** `modules/audit` is an interface with no implementation and
  nothing writes to `audit_logs`. Twelve write endpoints emit neither an audit
  record nor a domain event. The event bus exists with eleven event types and
  zero production publishers.
  **Blocked:** migration `20261002000006` drops the `audit_logs` INSERT/UPDATE/DELETE
  policies, so an `authenticated` client cannot write the table at all. Writing it
  needs a `SECURITY DEFINER` function, which is database-security scope
  (`feat/database-security`), not application scope. Until then the audit trail
  is read-only and empty.
- **No rate limiting.** `RateLimitError` is declared and never thrown. There is no
  `middleware.ts`. Combined with no request-body size limit, one authenticated
  request can carry a large payload. `items` is now capped at 200 per transaction,
  which bounds the worst case per request but not the request rate.
- **No security headers.** `next.config.ts` sets only `poweredByHeader: false`.
- **No cursor pagination.** Deep OFFSET is bounded, not made cheap.
- **Business record authorization is application-layer only.** RLS lets any active
  member read `businesses.gstin`/`pan` and the whole `business_members` roster
  directly through PostgREST using the public anon key, bypassing these routes. The
  policy gap is real; closing it needs a role-aware RLS policy, which is
  database-security scope.
- **No state-transition HTTP coverage in the route suite.** `canTransitionTo` is
  tested directly, but no test drives `PATCH /transactions/:id/status` through an
  illegal transition end to end.
- **N+1 on transaction list.** `GET /transactions?limit=100` issues 101 queries:
  one list plus one unbounded `transaction_items` load per row. Correct, but a
  100x amplification of a single request.
