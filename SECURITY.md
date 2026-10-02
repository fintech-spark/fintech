# Security baseline

OWASP Top 10:2025 is the baseline for future Merchant Brain work. This document establishes guardrails; it is not a claim that a production system exists or has passed a security audit.

## Trust boundaries

Treat browsers, uploaded files, OCR/transcripts, CSV cells, model output, retrieved content, webhooks, and third-party providers as untrusted. Validate at every boundary and keep secrets/server-only code off the client.

## Required controls

- **Authentication:** use an approved, maintained identity system; secure sessions, recovery, MFA policy, logout, and abuse controls. Do not invent auth in a route.
- **Authorization:** server-side, deny-by-default checks on every protected action; never use LLM output or a client claim as authorization.
- **Tenant isolation:** derive tenant/user scope from verified auth context, apply it to every query and storage path, and test cross-tenant denial.
- **RLS:** when a database with row-level security is approved, enable and test RLS policies in addition to application checks. RLS is not a substitute for auth.
- **API security:** validate inputs with Zod, use bounded payloads, rate limits, timeouts, idempotency for mutations, safe errors, and audit events for sensitive actions.
- **Secrets:** use environment/secret managers; never log or expose provider keys, auth secrets, upload URLs, or private data. Rotate and scope keys.
- **Uploads:** follow `docs/security/FILE_SECURITY.md`; validate magic bytes and MIME, isolate storage, scan/process asynchronously, and never execute uploads.
- **AI safety:** defend against prompt injection, tool abuse, data leakage, excessive agency, insecure output handling, and unbounded cost. Follow `docs/ai/AI_RULES.md` and `docs/ai/AI_ACTION_POLICY.md`.
- **XSS/CSRF:** use framework escaping and safe rendering; sanitize any intentional HTML; configure CSRF protection for cookie-authenticated state changes where relevant.
- **Injection:** parameterize database queries; do not interpolate SQL, shell, template, or provider requests with unvalidated input.
- **SSRF:** allowlist outbound hosts/protocols, block private/link-local metadata ranges, limit redirects, and use network egress controls.
- **Dependencies/supply chain:** commit lockfiles, review updates, run npm audit, Dependabot, CodeQL, Semgrep, and secret scanning; pin/maintain action versions.
- **Logging:** record security-relevant events without raw financial/personal content; alert on abuse; protect and retain logs intentionally.

## Security tooling prepared

- `.github/workflows/codeql.yml` for GitHub CodeQL.
- `.github/workflows/security.yml` for npm audit, Semgrep, Gitleaks, and dependency review.
- `.github/dependabot.yml` for npm and GitHub Action updates.
- `.gitignore`, `.env.example`, and `.npmrc` for local secret/dependency hygiene.

The workflows need repository permissions, GitHub Advanced Security availability, and branch protection to become effective controls. See `docs/security/GITHUB_SECURITY.md`.

## Security review gate

Every future feature documents data classification, trust boundaries, authorization, abuse cases, logging/redaction, dependency changes, and tests. High-risk actions require a human security review before merge. Never claim compliance from a checklist alone.
