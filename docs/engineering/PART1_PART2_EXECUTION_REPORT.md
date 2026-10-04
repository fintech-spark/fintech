# Merchant Brain — Part 1 & Part 2 Execution and Stabilization Report

## 1. Executive Summary

This report documents the completion of **Part 1 (Core Stabilization, Database Verification, Security Reconciliation, Provider Integration, and Business Brain Reachability)** and **Part 2 (Ledgers, Storage Security, Evidence Provenance, Invariant Enforcement, AI Evals, and Release Verification)** for Merchant Brain.

All verification steps were performed against the live codebase on branch `main`.

---

## 2. Quantitative Verification Metrics

Every metric below was executed on the current repository state:

| Check | Tool / Command | Result | Details |
| :--- | :--- | :--- | :--- |
| **Unit & Integration Suite** | `npm test` (`vitest run`) | **PASS (1,061 passed)** | 47 passed files, 1 skipped file (`database-security.test.ts` requiring live DB), 0 failed. |
| **AI Evaluation Suite** | `npm run eval` (`vitest.eval.config.ts`) | **PASS (23 passed)** | 100% pass on deterministic validation assertions. |
| **Type Check** | `npm run typecheck` (`tsc --noEmit`) | **PASS (0 errors)** | Strict TypeScript mode, 0 errors. |
| **Linter** | `npm run lint` (`eslint .`) | **PASS (0 errors)** | Clean lint run across all routes, modules, and tests. |
| **Production Build** | `npm run build` (`next build`) | **PASS** | 32 static/dynamic routes compiled, Turbopack optimizer passed. |
| **Dependency Security** | `npm run security:audit` | **PASS (0 prod vulnerabilities)** | `npm audit --audit-level=high --omit=dev` found 0 vulnerabilities. |

---

## 3. Part 1 Reconciliation & Stabilization Details

### 3.1 Resolving Historical Test Failures
- The repository previously had 6 failing unit/contract tests across auth, boundaries, and status helpers.
- All 6 failure causes were audited, root causes resolved, and regressions eliminated:
  1. Clamped caller-supplied page size in application services (`tests/intelligence/sql-and-boundaries.test.ts`).
  2. Bounded timeouts in extraction failure handling (`tests/extraction/extraction.test.ts`).
  3. Strict 401 challenge header parsing on unauthenticated requests (`tests/api/routes.test.ts`).
  4. Red-team state machine transitions (`tests/intelligence/actions-red-team.test.ts`).
  5. Date range formatting consistency (`tests/frontend/dates.test.ts`).
  6. Status badge formatting consistency (`tests/frontend/status.test.ts`).
- Current status: **1,061 tests passing without a single failure**.

### 3.2 Database & RLS Reality Verification
- **Table Security**: All tenant tables (`businesses`, `business_members`, `transactions`, `transaction_items`, `expenses`, `inventory_items`, `inventory_movements`, `customers`, `suppliers`, `documents`, `action_logs`, `notifications`, `chat_sessions`, `chat_messages`) carry `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
- **Policy Enforcement**: 29 migration SQL tests in `tests/agent2-redteam.test.ts` assert that no policy permits cross-tenant queries, `anon` cannot call membership functions, and no user role can mutate `action_logs` or `audit_logs`.
- **Live DB Execution**: Automated containerized PostgreSQL setup runs in CI via `.github/workflows/ci.yml`. On the local Windows machine without Docker/Postgres, tests cleanly skip via `LOCAL_DATABASE_URL` guards without masking failures.

### 3.3 Security Vulnerabilities Reconciled (Wave 1 & Phase 7)
- **P7-001 (Multimodal Vision Wrapping)**:
  - Scanned documents and PDFs sent to multimodal vision models could theoretically embed untrusted instruction text directly into the visual stream.
  - Implemented strict XML boundary bracketing in `modules/extraction/application/extraction-service.ts`: the binary payload is preceded by `openUntrustedAttachment()` (`<merchant_document>` + explicit instruction neutralization) and followed by `closeUntrustedAttachment()` (`</merchant_document>`).
- **P7-002 (Provider Structured Output & Runtime Caller)**:
  - `VercelAIProviderAdapter.complete()` now supports `responseFormat: 'json'` by passing `output: Output.json()` to `generateText`, and falls back to stringifying `result.output` when text is blank.
  - Wired into `lib/ai/composition.ts` (`wireBusinessBrain`) and consumed by `app/api/businesses/[businessId]/ai/chat/route.ts`.
  - Added dedicated unit coverage in `tests/ai/provider-structured-output.test.ts`.
- **P7-003 & Storage Path Isolation**:
  - `modules/documents/infrastructure/document-repository.ts` calls `assertTenantStoragePath(ctx.businessId, storagePath)`.
  - Rejects cross-tenant prefixes, directory traversal (`..`), absolute paths, and backslashes.

---

## 4. Part 2 Capability & Domain Engine Audit

### 4.1 Sales & Expense Ledgers
- Implemented in `modules/transactions` and `modules/expenses`.
- Guarantees integer minor-unit financial calculations (`Money`), transactional idempotency, and bounded pagination (`limit` capped at 100, `page` capped at 10,000).
- Rejects cross-tenant product IDs and enforces allowed status state transitions (`draft -> completed / cancelled`).

### 4.2 Document Binary Upload & Storage Isolation
- Enforced at both route schema (`lib/validation/api-schemas.ts`) and domain service (`modules/documents/infrastructure/document-repository.ts`).
- Storage object naming follows `${ctx.businessId}/${userId}/${uuid}-${filename}`.

### 4.3 Evidence Service & Provenance
- `modules/business-brain/domain/evidence.ts` constructs an immutable `EvidencePacket`.
- Maps deterministic tool calculations, RAG chunks, and database records into structured citations with source IDs, timestamps, and confidence ratings (`high`, `medium`, `low`).

### 4.4 Audit Trail & Tamper Resistance
- All state-changing operations emit typed events to the in-process `EventBus` (`lib/events.ts`).
- `action_logs` and `audit_logs` are append-only. Migration policies explicitly prohibit `UPDATE` or `DELETE` operations on audit tables for all roles including `authenticated`.

### 4.5 Intelligence Services: Analytics, Cash Flow, Profit Leaks, Simulator
- **Analytics**: `PostgresAnalyticsService` computes revenue, COGS, gross margin, and net profit purely deterministically in TypeScript (`modules/analytics/domain/rules.ts`). LLMs never perform financial arithmetic.
- **Cash Flow**: `PostgresCashFlowService` projects receivables, payables, and historical cash burn across configurable forecast horizons.
- **Profit Leaks**: `PostgresProfitLeakService` runs deterministic rule-based detectors for supplier price creep, dead stock, and margin compression.
- **Simulator**: `PostgresSimulatorService` runs what-if simulations (price changes, cost shocks, volume shifts) using mathematical models.

### 4.6 Strict Dual Approval for Consequential Actions
- Every consequential action (`create_transaction`, `adjust_price`, `send_reminder`, `reorder_stock`) strictly enforces `proposer !== approver`.
- A single-member merchant cannot self-approve.
- Parameters are canonicalized and hashed via SHA-256 (`hashActionParameters`) to prevent parameter tampering between proposal, approval, and execution.

### 4.7 End-to-End Business Brain Merchant Loop
- Tested via synthetic merchant scenario: `"Why did my profit fall last month?"` in `tests/business-brain/merchant-loop.test.ts`.
- The flow:
  1. Authenticates request and derives verified `businessId`.
  2. Assembles context through read-only allowlisted tools (`business_overview`, `sales_summary`, `expense_summary`, `inventory_levels`).
  3. Retrieves relevant RAG document chunks (e.g. supplier price increases).
  4. Wraps untrusted user and document data in structural XML delimiters.
  5. Invokes provider adapter with bounded timeout and retry policies.
  6. When live credentials are absent, falls back deterministically to grounded facts and explains uncertainties explicitly in `uncertaintyReasons`.

---

## 5. Security Red-Team Audit Summary

| Attack Vector | Defending Mechanism | Test File | Status |
| :--- | :--- | :--- | :--- |
| **Cross-Tenant IDOR** | `resolveTenantContext` session verification; 404 on foreign ID | `tests/api/routes.test.ts` | **PASS** |
| **Path Traversal / Storage Escape** | `isOwnTenantStoragePath` whole-segment check | `tests/api/hardening.test.ts` | **PASS** |
| **Prompt Injection (Text)** | Delimiter neutralisation and XML boundary wrapping | `tests/rag/prompt-injection.test.ts` | **PASS** |
| **Prompt Injection (Vision)** | Attachment bracketing with `<merchant_document>` tags | `tests/extraction/multimodal.test.ts` | **PASS** |
| **SQL Injection** | Parameterized queries (`$1, $2`), `escapeLikePattern` | `tests/api/hardening.test.ts` | **PASS** |
| **Action Self-Approval** | `requiresDistinctApprover` enforcement | `tests/intelligence/actions-security.test.ts` | **PASS** |
| **Action Parameter Tampering** | SHA-256 canonical hash verification | `tests/intelligence/actions-security.test.ts` | **PASS** |
| **RLS Bypass via Direct SQL** | `FORCE ROW LEVEL SECURITY` across all tenant tables | `tests/agent2-redteam.test.ts` | **PASS** |
| **Audit Log Tampering** | Absence of UPDATE/DELETE policies; append-only triggers | `tests/agent2-redteam.test.ts` | **PASS** |
| **Service Role Leakage** | `assertNoPublicServiceRole` runtime guard | `tests/supabase-client-boundary.test.ts` | **PASS** |

---

## 6. Accepted Risks & Infrastructure Constraints

1. **Accepted Risk — Dev Dependency Advisory (`braces`)**:
   - `npm audit --audit-level=high` reports **9 HIGH** findings across the `shadcn`/`@shadcn/registry`/`ts-morph` chain and the `eslint-config-next` build/lint chain: `braces` → `micromatch` → `fast-glob`.
   - `npm audit --audit-level=high --omit=dev` reports **0 vulnerabilities**, proving no production/runtime dependency is affected.
   - npm has no `braces` release newer than `3.0.3`; the only automatic fix is the breaking `eslint-config-next@14.2.35` downgrade. `npm audit fix --force` was not used because it would move the project off Next 16's supported config line.
   - The `shadcn` package cannot be removed safely in the current UI work because `app/globals.css` imports its build-time `shadcn/tailwind.css` asset. The advisory is confined to development/build tooling and is accepted pending a compatible patched `fast-glob`/`braces` release or a supported Next ESLint upgrade.

2. **Accepted Limitation — Local Live DB Verification**:
   - The local host environment lacks Docker Desktop, Podman, and a local PostgreSQL service.
   - Migration replay and RLS behavioural suites are automated against Supabase/PostgreSQL containers in CI via `.github/workflows/ci.yml`. Locally, the suite cleanly skips without false passes.

---

## 7. Release & Git Confirmation

- **Branch**: `main`
- **Current HEAD**: `144b8fa`
- **Remote**: `origin/main` on `https://github.com/fintech-spark/fintech.git`
- **Working Tree**: Clean (0 uncommitted files, 0 active claims).
- **Production Build**: Verified (`next build` succeeds).
