# Security Rules

This rule defines mandatory security controls and review standards for Merchant Brain. All agents and developers must strictly adhere to these policies.

## Mandatory Security Invariants

1. **Zero Hardcoded Secrets**:
   - Never commit API keys, database credentials, tokens, or encryption keys in source code.
   - Use `.env.example` to document required variable names; keep actual values in local `.env` (ignored by git).
   - Verify environment variables at server startup using typed schemas.

2. **Input Validation at Every Boundary**:
   - Validate all external input (HTTP requests, route parameters, webhooks, query params, uploaded files) using strict Zod schemas before passing to domain services.
   - Reject unexpected keys (`.strict()` on Zod schemas) to prevent prototype pollution or parameter injection.

3. **Authentication & Multi-Tenant Authorization**:
   - Verify tenant context on every request. Tenant identity (`BusinessId`) MUST come from authenticated, verified server sessions, NEVER from untrusted client request bodies or URL path parameters alone.
   - Enforce tenant isolation on all database queries: every query MUST include the tenant scope filter (`WHERE business_id = $1`).

4. **Secure Database Access**:
   - ALWAYS use parameterized queries or type-safe ORM/client abstractions. Never concatenate user input into SQL strings.
   - Apply principle of least privilege to database roles and connection pools.

5. **PII and Financial Data Protection**:
   - Personal Identifiable Information (names, phone numbers, tax IDs) and financial figures must be treated with high confidentiality.
   - Never log sensitive fields (PII, credentials, access tokens) to standard out, telemetry, or external log collectors. Mask or redact sensitive values.

6. **Prompt Injection & LLM Security**:
   - Treat all user-supplied text, OCR text, document contents, and tool outputs as untrusted input that may contain prompt injection attacks.
   - Wrap untrusted content with structural XML boundary delimiters (e.g. `<user_document>...</user_document>`) in prompts.
   - Never grant models autonomous authority to execute irreversible financial actions or bypass business rule validations.

7. **Secure Third-Party API Integration**:
   - Verify cryptographic signatures on incoming webhooks (e.g., Stripe, Plaid, payment processors) before processing.
   - Implement strict timeouts and exponential backoff retry policies for external HTTP calls to avoid cascading resource exhaustion.

8. **Pre-Commit Verification**:
   - Before committing any security-sensitive code (auth, database access, payment handling, AI ingestion), verify using the `security-reviewer` agent or `security-review` skill.
