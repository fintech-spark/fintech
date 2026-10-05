# Production integration verification — 2026-10-05

## Implemented scope

- Documents: bounded binary upload into private `merchant-files`, server content/type/hash checks, persisted extraction candidates/evidence, failure/retry states, corrected human review and atomic idempotent invoice/expense promotion.
- Actions: strict parameters, hash-bound approval, distinct approver, expiry, owner execution, durable claims/outcomes and transactional internal report/price/supplier effects with immutable audit. External messaging/reorder operations remain unsupported.
- Brain/evidence/RAG: verified membership and permissions, user/business/session-scoped durable history, real source authorization and query snapshots, fail-closed structured answers, consistent embedding selection and tenant-locked atomic vector replacement. Indexing uses source excerpts; unapproved candidate amounts are not ledger facts.
- Security fixes: tenant-safe profit-leak upserts, recipient-scoped notifications, atomic business provisioning, trusted-origin mutations, explicit read-only demo opt-in, immutable approved document source identity, operational child-row roles and narrow approved-document index recovery.

## Local verification environment

Docker Supabase supplied a disposable PostgreSQL database, `data_production_20261005_verified`. All 23 repository migrations through `20261005000027` were applied with zero pending migrations and no checksum drift. Original local merchant data was preserved. Credentials were passed in memory, not committed.

Production compilation and Chromium used `.next-production`; the existing development server on port 3000 remained available. Browser journeys used a synthetic backend on port 4599 and the production app on port 3001. They are not full live Supabase storage/auth/provider integration tests.

## Verification commands

```bash
# First set DATABASE_URL and LOCAL_DATABASE_URL to a disposable migrated database.
NODE_ENV=production NEXT_BUILD_DIR=.next-production npm run verify:setup
npm run test:db:live
npm run eval
AI_EVAL_LIVE=1 AI_EVAL_PROVIDER=google AI_EVAL_MODEL=gemini-3.1-flash-lite npm run eval:live
NODE_ENV=production npm run test:e2e
node tests/documents/browser-check.mjs
npm audit --audit-level=high --omit=dev
git diff --check
```

The final unified gate passed lint, typecheck, 85 test files / 1,453 tests with zero skips, and the production build. Offline evaluations passed 56 cases across five files. Database-enabled verification includes actual isolation/workflow tests. Separate live repository tests passed 37 cases. The full Chromium run passed 58 cases, including 12 viewport/theme combinations over 15 routes; the isolated document-browser check also passed. Live reasoning/extraction passed nine synthetic cases using Google's `gemini-3.1-flash-lite`; this is fixture evidence, not a general reliability estimate.

Final code/security review found and repaired mismatched metric excerpt representations, sign/scientific-notation/unit validation weaknesses, genuine observation-date rejection and untrusted history delimiter escape. Follow-up probes confirmed sentence punctuation and cross-currency suffix bypasses were closed. Regression cases cover forged quotes/identities, invented amounts/dates, unit/currency changes and forged history/registry tags. The merchant-loop wiring test explicitly injects an offline provider so developer credentials cannot trigger paid calls there. The focused final re-review reported no remaining material issue in its inspected scope.

## Remaining and blocked checks

- Hosted migrations and the complete hosted upload → extraction → approval → ledger → Brain journey remain unverified. Some new parent constraints are `NOT VALID`: new writes are constrained, but historical validation remains a deployment task.
- Google `gemini-2.5-flash` generation returned HTTP 404 despite model discovery succeeding; `gemini-3-flash-preview` returned HTTP 503. `gemini-3.1-flash-lite` passed the synthetic gate. Set and verify deployment `AI_MODEL_*` explicitly; availability and quality do not transfer between models.
- The production dependency audit reported zero vulnerabilities. The full development audit reported nine high-severity advisories through `braces@3.0.3`/`micromatch`/`fast-glob` in development tooling. No safe patched `braces` version was identified; a forced breaking dependency rewrite was not applied.
- Vercel CLI was logged out and the workspace had no `.vercel/project.json`. No deployment or deployed commit was verified. `/api/health` now reports `VERCEL_GIT_COMMIT_SHA` when supplied by the deployment.
- Gitleaks/Semgrep executables were unavailable locally. Source review is not a claim that those scanners ran. External side-effect adapters are still required for messages and reorders.

Historical root audit reports and some skill descriptions predate these integrations. Source code, current checks and this scoped record supersede their implementation-state claims; they do not change the architecture or approval rules in `AI_CONTEXT.md`.
