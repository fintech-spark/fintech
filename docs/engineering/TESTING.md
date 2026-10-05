# Testing strategy

The foundation uses Vitest for deterministic tests and Playwright for critical browser journeys. Tests are a safety net for user behavior and business invariants, not a reason to build product features before requirements are approved.

## Unit tests

Test pure financial calculations, rounding, date/period logic, business rules, Zod validation, normalization, transformations, evidence envelopes, permission predicates, and malformed model output. Include boundaries, missing values, conflicting records, currency/locale cases, and adversarial strings.

## Integration tests

When integrations exist, test AI provider calls with deterministic mocks/recorded synthetic fixtures, extraction pipelines, database interactions, authentication, authorization, tenant isolation, uploads, rate limits, retries, timeout behavior, and error mapping. Never call paid models or production services in the default test suite.

## E2E with Playwright

`tests/e2e/` exercises merchant journeys, navigation, approval/error states and a 15-route matrix across four viewport sizes and Light/Dark/System themes. It runs the production bundle on port 3001 against synthetic HTTP fixtures. This verifies actual browser rendering and client/server boundaries, not a hosted Supabase/provider journey. `node tests/documents/browser-check.mjs` separately exercises the document client upload/review/retry flow with synthetic transport.

The production browser build uses `NEXT_BUILD_DIR=.next-production`; an existing `.next` development server can continue running. Use the same directory for build and start. Next.js regenerates `next-env.d.ts`; preserve unrelated local changes when staging.

Use accessible roles/labels, deterministic synthetic data, isolated test state, and trace-on-failure. Do not use arbitrary sleeps. Install browsers with `npm run test:e2e:install`.

## AI evaluation

`npm run eval` runs offline synthetic fixtures and deterministic graders. `AI_EVAL_LIVE=1 npm run eval:live` explicitly opts into paid provider-backed synthetic reasoning/extraction cases; configure `AI_EVAL_PROVIDER` and `AI_EVAL_MODEL` externally. Provider errors fail that gate. Neither suite measures general hallucination reliability or exercises real merchant data. See `evals/README.md`.

## Test data

Use only synthetic fixtures under `tests/fixtures/`. Mark them as test-only and include malformed and malicious cases. Do not commit real personal, financial, merchant, or provider data.

## Required commands

```bash
npm run lint
npm run typecheck
npm test
npm run eval                 # offline; no credentials or paid calls
npm run build
npm run test:db              # structural migration and Zod schema tests
DATABASE_URL=... npm run test:db:live  # exercises real repositories against live PostgreSQL
npm run test:e2e:install     # once per machine
npm run test:e2e
npm run security:audit
```

A command that was skipped, unavailable, or failed is reported as such; it is not counted as a pass.

For complete local database-enabled verification, migrate a disposable synthetic database and set both `DATABASE_URL` and `LOCAL_DATABASE_URL` before `npm run verify:setup`. Without `LOCAL_DATABASE_URL`, database-security and production workflow suites can be skipped while the default unit gate stays green. Tests must never point at hosted merchant data.
