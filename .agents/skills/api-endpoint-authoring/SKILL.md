---
name: api-endpoint-authoring
description: Add or change a Next.js route handler under app/api/ in this repo. Use when creating a new endpoint, editing an existing route.ts, adding pagination/sorting/filtering, changing a request or response shape, wiring a domain service into HTTP, or fixing a status code, error body, or 400/401/403/404/409/413 response. Encodes the withApi/withAuthApi pipeline, the two wiring factories, the 1 MiB body cap, and the tenant-param contract.
---

# API endpoint authoring

57 handlers exist: 6 under `app/api/auth/`, 2 business-root, 47 tenant-scoped under
`app/api/businesses/[businessId]/`, 1 health. No `middleware.ts` — **every route is its own
security boundary**, which is why the wrapper choice matters.

## Pick the wrapper

| Wrapper | Use for | Provides |
|---|---|---|
| `withApi` (`lib/http/handler.ts:40`) | all tenant routes | awaits `context.params`, try/catch, JSON response |
| `withAuthApi` (`lib/auth/http.ts`) | `/api/auth/*` | the above **plus** `assertTrustedOrigin` and rate limits |

`assertTrustedOrigin` is **only** in `withAuthApi`. Tenant mutations rely on `SameSite=Lax` alone.
If you add a state-changing tenant route that a browser can be tricked into cross-site, either use
`assertTrustedOrigin` explicitly or note the gap.

## The pipeline, in order

```ts
export const POST = withApi<TransactionDto>(async (request, context) => {
  const ctx = await resolveTenantContext(request, businessIdFromParams(context.params));
  const body = await parseJsonBody(request, createTransactionSchema);
  const service = wireClient(ctx.accessToken);
  return { data: await service.transactions.create(ctx, body), status: 201 };
});
```

1. `businessIdFromParams(context.params)` — `params` is a **Promise**; the helper unwraps it.
2. `resolveTenantContext(request, businessId)` (`lib/http/auth-context.ts:138`) — extracts the
   access token, revalidates the JWT via `getUser()`, calls the `auth_user_businesses()` RPC,
   `parseUuid`s the param, checks membership (**403** if absent), then `resolveRole` (**403** if
   no active membership row).
3. `parseJsonBody(request, schema)` (`lib/http/params.ts:291`) — streaming with a **1 MiB cap**;
   over it returns **413**. Takes the Zod schema directly; there is no separate parse step.
4. `wireClient(ctx.accessToken)` for RLS-backed domains, `wireIntelligence(ctx.businessId)` for
   the raw-`pg` domains (see `tenant-isolation-review` — the latter enforces nothing for you).
5. Return `{ data, meta? }`. Set `status: 201` for creation. Errors: throw an `AppError`
   subclass; `toErrorResponse` (`lib/http/errors.ts:36`) maps it.

## Validation and parsing

- Zod schemas live in `lib/validation/api-schemas.ts`. **No schema accepts a client `id` or
  `businessId`** — `tests/database-validation.test.ts` enforces this. Keep it true.
- `parseUuid`, `parseDate`, `parseEnum` (`lib/http/params.ts:99-125`) produce field-level 400s.
- `resolveSort` (`:81`) takes an **allowlist**; never pass a raw user string to `.order()`.
- Pagination: `parsePagination` (`:46`) caps `MAX_PAGE_SIZE = 100`, `DEFAULT_PAGE_SIZE = 20`,
  `MAX_PAGE_NUMBER = 10_000`. Return paging info in `meta`.

## Error mapping

`normalizeError` (`lib/http/errors.ts:54`) → `wrapDatabaseError` (`lib/errors.ts:155`):
`23505` → **409**, `23503` → **400**, everything else → generic **500**. Driver text and SQLSTATE
never reach the client. Throw `ValidationError` (400), `AuthenticationError` (401),
`AuthorizationError` (403), `NotFoundError` (404), `ConflictError` (409),
`PayloadTooLargeError` (413), `BusinessRuleError` (422), `RateLimitError` (429).

## Gotchas

- **401 vs 403:** 401 = not authenticated (no/invalid token). 403 = authenticated but not permitted
  (non-member, or role lacks the permission). Getting these backwards leaks existence information.
- **404 for cross-tenant ids**, not 403 — a 403 confirms the row exists.
- `hasPermission` is enforced inside the seven PostgREST repositories, **not** by the wrapper. On
  the `wireIntelligence` path nothing calls it; you must.
- `/api/health` is unauthenticated and unrated — do not add business data to it.
- The AI chat route defaults every caller to `sessionId: "default-session"`; session state is
  currently not tenant-namespaced (see `ai-provider-tools`).
- Adding a `DELETE` to a tenant table means checking whether RLS actually denies it —
  `action_logs` currently allows member deletes.

## Validation

```bash
npm run typecheck
npx vitest run tests/api tests/database-validation.test.ts
npm run build          # route handlers are type-checked against NextRouteContext at build
```

## References

- `references/error-catalog.md` — full `AppError` → status table and response envelope
- `.agents/rules/api-security.md` — standing API security policy
