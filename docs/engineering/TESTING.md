# Testing strategy

The foundation uses Vitest for deterministic tests and Playwright for critical browser journeys. Tests are a safety net for user behavior and business invariants, not a reason to build product features before requirements are approved.

## Unit tests

Test pure financial calculations, rounding, date/period logic, business rules, Zod validation, normalization, transformations, evidence envelopes, permission predicates, and malformed model output. Include boundaries, missing values, conflicting records, currency/locale cases, and adversarial strings.

## Integration tests

When integrations exist, test AI provider calls with deterministic mocks/recorded synthetic fixtures, extraction pipelines, database interactions, authentication, authorization, tenant isolation, uploads, rate limits, retries, timeout behavior, and error mapping. Never call paid models or production services in the default test suite.

## E2E with Playwright

Use `tests/e2e/` for high-value journeys such as signup, login, onboarding, upload, extraction review, approval, dashboard, profit leak, cash flow, simulator, assistant, and action center once those features exist. The current E2E test checks only the neutral setup route.

Use accessible roles/labels, deterministic synthetic data, isolated test state, and trace-on-failure. Do not use arbitrary sleeps. Install browsers with `npm run test:e2e:install`.

## AI evaluation

AI behavior is tested separately through Promptfoo preparation in `evals/`. Cover extraction accuracy, evidence grounding, unsupported claims, schema validity, injection resistance, unauthorized requests, consistency, cost, and latency. A passing unit test does not prove an AI claim is reliable.

## Test data

Use only synthetic fixtures under `tests/fixtures/`. Mark them as test-only and include malformed and malicious cases. Do not commit real personal, financial, merchant, or provider data.

## Required commands

```bash
npm run lint
npm run typecheck
npm test
npm run eval                 # runs 35 automated synthetic AI evals
npm run build
npm run test:db              # structural migration and Zod schema tests
DATABASE_URL=... npm run test:db:live  # exercises real repositories against live PostgreSQL
npm run test:e2e:install     # once per machine
npm run test:e2e
npm run security:audit
```

A command that was skipped, unavailable, or failed is reported as such; it is not counted as a pass.
