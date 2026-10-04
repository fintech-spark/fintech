# Error catalog

Single exit point: `toErrorResponse(error)` (`lib/http/errors.ts:36`) → `normalizeError` (`:54`).
Every route must throw; none should build an error body by hand.

| Error class | Status | `code` | Raise it when |
|---|---|---|---|
| `ValidationError` | 400 | `VALIDATION_ERROR` | schema/parse failure; carries field-level `issues` |
| `AuthenticationError` | 401 | `UNAUTHENTICATED` | no token, invalid/expired token, bad credentials, rejected origin |
| `AuthorizationError` | 403 | `FORBIDDEN` | authenticated but not a member, or role lacks the permission |
| `NotFoundError` | 404 | `NOT_FOUND` | absent row **or a row belonging to another tenant** |
| `ConflictError` | 409 | `CONFLICT` | duplicate signup, unique violation, illegal state transition |
| `PayloadTooLargeError` | 413 | `PAYLOAD_TOO_LARGE` | body over the 1 MiB cap in `parseJsonBody` |
| `BusinessRuleError` | 422 | `BUSINESS_RULE_VIOLATION` | domain rule refused (e.g. insufficient stock) |
| `RateLimitError` | 429 | `RATE_LIMITED` | rate limit consumed |
| `AIValidationError` | 502 | `AI_VALIDATION_ERROR` | model output failed schema validation |
| `AIProviderError` | 502 | `AI_PROVIDER_ERROR` | provider timeout/unavailable/bad key/malformed output |
| `DatabaseError` | 500 | `DATABASE_ERROR` | unexpected driver failure |
| `ToolExecutionError` | 500 | `TOOL_EXECUTION_ERROR` | AI tool timeout or oversized payload |
| `StorageError` | 500 | `STORAGE_ERROR` | file upload/storage failure |

## Response envelope

```json
{ "error": { "name": "Error", "code": "VALIDATION_ERROR", "message": "…", "statusCode": 400 } }
```
`ValidationError` adds `details.issues`. Use `metadata` for non-sensitive diagnostics.

## Database error mapping (`wrapDatabaseError`, `lib/errors.ts:155`)

| SQLSTATE | Result |
|---|---|
| `23505` unique violation | `ConflictError` 409 |
| `23503` foreign key violation | `ValidationError` 400 |
| anything else | generic `DatabaseError` 500 |

Driver text and SQLSTATE never cross the wire. Repositories additionally treat `23505` on
idempotent money operations as a successful replay.

## Rules

- Never leak provider or driver strings. `mapAuthError` (`lib/auth/supabase.ts`) returns messages
  *we* wrote, because upstream auth messages distinguish "no such user" from "wrong password".
- A cross-tenant record id returns **404**, not 403 — a 403 confirms the row exists.
- `AIValidationError.details` carries `rawOutput`; do not throw it with model output you would not
  want echoed to a browser.
- `correlationId` is generated per request (`lib/http/auth-context.ts:157`) but is not currently
  returned in the body. When adding it to responses, keep it a random opaque id — never the tenant id.
