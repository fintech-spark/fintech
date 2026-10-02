# API Security & Integration Rules

This rule defines standards for designing, securing, and consuming APIs within Merchant Brain.

## Inbound API Security (Route Handlers)

1. **Authentication & Session Extraction**:
   - Every protected route handler in `app/api/` must extract and verify session tokens on the server.
   - Tenant context (`businessId`) must be derived from verified server session state.

2. **Strict Request Parsing**:
   - Request bodies, query parameters, and headers must be parsed using Zod schemas (`.parse()` or `.safeParse()`).
   - Reject oversized payloads by setting explicit body size limits.

3. **Rate Limiting & Abuse Prevention**:
   - Public and sensitive endpoints (auth, ingestion, AI queries) must be rate-limited by IP and tenant key to prevent brute-force attacks and denial-of-service.

4. **Security Headers**:
   - Next.js responses must include security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and Content Security Policy (CSP).

## Outbound & Third-Party Integration Security

1. **Credential Safety**:
   - API tokens for third-party providers (OpenAI, Anthropic, payment gateways) must be loaded securely via server environment variables. Never expose them to client components or URLs.

2. **Egress Protection & Timeouts**:
   - All external HTTP requests must specify an explicit timeout (maximum 10 seconds for synchronous requests).
   - Use exponential backoff with jitter for retries to prevent thundering herd problems.

3. **Webhook Verification**:
   - Verify incoming webhook signatures using raw request bodies and provider secrets before dispatching events.
