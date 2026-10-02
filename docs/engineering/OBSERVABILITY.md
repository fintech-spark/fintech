# Observability

Observability will be added at approved integration boundaries. The current setup has no production telemetry and does not claim Sentry is configured.

## Sentry preparation

When the first real client/API routes exist, evaluate the official `@sentry/nextjs` package and configure it through environment variables in `.env.example`. Keep DSN, auth token, org, and project values secret. Use the version-compatible Sentry Next.js setup and verify source-map/upload behavior in CI before enabling it.

Do not install or initialize Sentry in the setup-only route merely to produce unused runtime code.

## Signals to monitor

- Frontend errors, route failures, hydration issues, and accessibility/runtime warnings.
- API error rates, authorization denials, validation failures, timeouts, retries, and rate limits.
- AI provider availability, schema failures, refusals, evidence failures, latency, token usage, and fallback rates.
- Extraction quality/processing failures, queue age, file rejection categories, and tool failures.
- Build, test, E2E, security, and AI-evaluation failures.

## Privacy and sampling

Redact or hash tenant/user/resource identifiers where possible. Never log raw financial documents, credentials, tokens, full prompts, full model responses, or personal contact data by default. Use safe metadata, sampling, retention limits, and access controls. Keep audit events separate from debugging telemetry when they have different retention needs.

## Alerting and ownership

Define service-level thresholds only after baseline workloads exist. Alerts should have an owner, severity, runbook, and privacy-safe sample. A metric without an actionable response is not an observability requirement.
