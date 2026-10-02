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
