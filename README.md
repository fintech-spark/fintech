# Merchant Brain

An AI-powered business operating system for small merchants in India. It understands the
business data a merchant already has, explains what is going wrong and what is going right,
simulates decisions before they are made, and helps the merchant act — with human approval at
every irreversible step.

> **Don't make the merchant learn software — make the software understand the merchant.**

## The problem

Small merchants are not short of data. They are short of **interpretation**. Records live
across WhatsApp, UPI, paper invoices, receipts, spreadsheets, and memory. A merchant knows
*sales have gone down* — but not why, which products, which customers, where the cash went,
or what would happen if they changed something.

```
DATA → UNDERSTANDING → DIAGNOSIS → SIMULATION → DECISION → ACTION
```

## Architecture

A **modular monolith**: one repository, one deployable Next.js unit, one PostgreSQL database,
19 isolated domain modules, and an in-process typed event bus. No microservices, no message
broker. AI is provider-agnostic.

The rule the whole design protects:

| Layer | Owns |
|---|---|
| PostgreSQL | the facts |
| Analytics and rules | the numbers (deterministic) |
| RAG | the context (unstructured) |
| AI | the explanation (evidence-backed) |
| Tools | controlled data access |
| Human approval | irreversible and financial actions |
| Audit | what actually happened |

**An LLM is never the source of truth for arithmetic, identity, permissions, or an
irreversible action.**

## Documentation

Full documentation lives in [`docs/`](docs/README.md).

| Start with | Why |
|---|---|
| [`AI_CONTEXT.md`](AI_CONTEXT.md) | **The authoritative statement of the project.** It wins on conflict |
| [`AGENTS.md`](AGENTS.md) | Agent instructions and mandatory skill triage |
| [`SKILLS.md`](SKILLS.md) | The skill index agents read first |
| [`docs/product/PRODUCT_SPEC.md`](docs/product/PRODUCT_SPEC.md) | Problem, users, and scope |
| [`docs/product/ROADMAP.md`](docs/product/ROADMAP.md) | The 14 delivery phases |
| [`docs/engineering/DATABASE.md`](docs/engineering/DATABASE.md) | Schema and data layer |

## Stack

- Next.js 16 App Router, React 19, TypeScript (strict), Tailwind CSS 4
- shadcn/ui on Radix primitives, Lucide icons, Recharts
- PostgreSQL via Supabase, with `pgvector` for embeddings
- Vercel AI SDK with Google, Anthropic, and OpenAI providers behind one abstraction
- Zod for schema validation, React Hook Form for forms
- Vitest for unit tests, Playwright for E2E, Promptfoo for AI evals
- ESLint, CodeQL, Semgrep, Gitleaks, and Dependabot in CI

## Status

Verified state (`main` branch; audit: `PC1_FINAL_REPORT.md`):

- **Foundation and architecture:** Complete. Modular monolith (19 modules), database schema and migrations (`database/`), tenant-aware client (`DatabaseClient`, `TenantDatabaseClient`), RLS policies, validation layer, event bus (`lib/events.ts`), and branded-ID types (`lib/types.ts`) all present and tested.
- **Backend / Security:** Complete. Auth routes (`app/api/auth/*/route.ts`) with rate limits (`IP_POLICY` 20/min + `CREDENTIAL_POLICY` 5/min), session cookies, `assertTrustedOrigin`. Request identity (`lib/http/auth-context.ts`: `requireRequestContext` with JWT verification + `auth_user_businesses()` RPC). Tenant isolation (`resolveTenantContext`: `businessId` from verified session only; never body/query). Authorization (`assertPermission` + role matrix: owner/admin/manager/accountant/staff). IDOR defense (`tests/api/routes.test.ts:504-556` verifies cross-tenant `id` returns 404). Input validation (`parsePagination` cap 100/10_000; `parseUuid`; `parseEnum`; `parseSearch` cap 120 + LIKE escape; `dateRangeArgs`; `MAX_BODY` 1MiB). Sort/SQL defense (`resolveSort` allowlist; `escapeLikePattern`; no raw SQL). Safe error mapping (`toErrorResponse`; `normalizeError`). Service-role/admin split (`tests/supabase-client-boundary.test.ts`). Security headers (`ba3d6e3`). No arbitrary SQL surface (`tests/ai-tools/tool-execution-security.test.ts`; `tests/intelligence/sql-and-boundaries.test.ts` static check exists but no injection surface found).
- **Business / Transaction / Expense / Inventory / Customer / Supplier / Document APIs:** Complete. All routes use `resolveTenantContext`, bounded pagination, enum allowlists, UUID path validation, and real contracts. Document APIs (`documents/route.ts`, `[id]/route.ts`, approve/reject/status) enforce authorization and expose metadata only (binary upload adapter documented as pending, not invented).
- **Analytics / Intelligence services:** Service interfaces and repositories exist (`PostgresAnalyticsService`, `PostgresProfitLeakService`, `PostgresCashFlowService`, `PostgresSimulatorService`). Routes (`analytics/snapshot`, `profit-leaks`, `cash-flow/forecast`, `simulator/scenarios`) exist but deeper aggregated analytics roll-up and full predictive forecasting depend on the intelligence automation layer (`pendingCapability` documents these gaps honestly rather than inventing dashboards).
- **AI / Intelligence layer & Provider Integration:** Complete. `modules/rag`, `modules/business-brain`, `modules/extraction`, `lib/ai`, evaluation framework (`evals/`), and AI tool registry are operational. `VercelAIProviderAdapter` (`lib/ai/providers/vercel-ai-adapter.ts`) supports schema-constrained structured generation (a caller-supplied Zod schema routes to `Output.object({ schema })`; `responseFormat: 'json'` without a schema requests JSON syntax only), rejects empty completions rather than returning them as successful stops, and implements bounded timeouts, retry backoff, and model routing across Google, Anthropic, and OpenAI. The AI chat route (`app/api/businesses/[businessId]/ai/chat/route.ts`) connects to `wireBusinessBrain` with verified session-derived tenant context, read-only allowlisted tools, and sends the assembled evidence region (`<trusted_facts>`, `<deterministic_metrics>`, `<retrieved_evidence>`, `<conflicts>`, wrapped `<merchant_question>`) to the model. Provider failures fall back to the deterministic grounded answer and are reported in `metadata.degradedReason` rather than swallowed. No fake AI answers or fabricated business facts. **RAG retrieval is not yet wired in production**: `wireBusinessBrain` builds the context assembler with no retriever, so `retrievalEnabled` is always false and the pgvector path (`match_document_embeddings`) is exercised only by tests.
- **Frontend / Product experience:** Complete. Application shell (`components/layout/app-shell.tsx`): real states (`signed_in`, `needs_account`, `backend_unavailable`). Navigation (`nav-config.ts`): 5 merchant-facing groups. Responsive layout (`md:flex` sidebar + mobile safe-area). Design system (`globals.css` semantic tokens; shadcn primitives; `status` vocabulary in `lib/format/status.ts` with label + icon + description, never colour alone). Dashboard (`app/(dashboard)/overview/page.tsx`): uses `settle` with 6 independent reads; authoritative metrics (`revenueMinor`, `grossProfitMinor`, `operatingExpensesMinor`, `netProfitMinor`, `inventoryValue`, `lowStock`, `documentsNeedingReview`). Documents review (`components/documents/document-review.tsx`): live approval/rejection boundary with non-optimistic updates, confirmation dialog, cancel path, required reason, spinner, indeterminate state, idempotency derived from document id + decision (`FRONTEND.md` §7 rules). Accessibility: skip link, semantic headings (`card-heading` provides real `<h3>`), `focus-visible` ring, `aria-label` on icon-only buttons, `prefers-reduced-motion`, `tabular-nums` (`FRONTEND.md` §169-191; `tests/e2e/navigation.spec.ts` asserts responsive overflow at 390px; `tests/frontend/security.test.ts` asserts no fixtures/mock mode in production). Real contracts consumed (`WireDocument`, `Page`, `WireAiChatResponse`, `Settled`, `CurrencyCode`). Loading/empty/error/unavailable states implemented (`components/common/data-state.tsx` uses TypeScript-enforced discriminated union; `CapabilityPanel`, `MetricCard`, `StatusBadge`, `FreshnessLine` reused consistently).
- **Pending capabilities (honest gaps, documented — not hidden or invented):** `lib/api/pending.ts` (`pendingCapability`) records: analytics roll-up (`analyticsOverview` — Phase 4), full business brain reasoning service (`businessBrain` — Phase 9, UI exists, deeper reasoning awaits PC2 provider layer), cash-flow forecast (`cashFlow` — Phase 4), simulator (`simulator` — Phase 4), profit leaks (`profitLeaks` — Phase 4), notifications (`notifications` — Phase 4), audit trail (`auditTrail` — Phase 13), evidence service (`evidencePanel` — Phase 6), document upload binary adapter (`documentUpload` — Phase 3), sales ledger full list (`salesLedger` — Phase 3), expense ledger full list (`expenseLedger` — Phase 3). No charts (`FRONTEND.md` §12 — excluded by design because no approved aggregation route exists; inventing charts would invent unverified data). No dark-mode toggle (`.dark` tokens exist; no product requirement).
- **Tests:** Unit & Integration (**1,061 passed**, 29 skipped live-database tests, **0 failed** across 48 test files), evals (**23 passed**, 0 failed), lint (**PASS**, 0 errors), typecheck (**PASS**, 0 errors), build (**PASS**). Security tests (`tests/api/security.test.ts`, `tests/agent2-redteam.test.ts`, `tests/auth/routes.test.ts`, `tests/auth/rate-limit.test.ts`, `tests/auth/permissions.test.ts`, `tests/auth/schemas.test.ts`, `tests/auth/session-cookies.test.ts`, `tests/auth/supabase-mapping.test.ts`, `tests/auth/origin.test.ts`, `tests/ai/provider-structured-output.test.ts`) verify auth/authz/tenant isolation/security boundaries.
- **Build:** `npm run build` passes (`main` branch; production bundle exercises real client/server boundary via `AppShell`, 32 routes compiled via Turbopack).
- **Documentation:** `AI_CONTEXT.md` (authoritative architecture), `AGENTS.md` (agent rules), `SKILLS.md` (skill index), `FRONTEND.md` (frontend architecture), `DESIGN_SYSTEM.md` (visual tokens), `SECURITY.md`, `docs/engineering/API_RULES.md`, `docs/engineering/TESTING.md`, `docs/engineering/DATABASE.md`, `docs/agents/COORDINATION.md`, `docs/product/ROADMAP.md`/`PRODUCT_SPEC.md`, `docs/engineering/PART1_PART2_EXECUTION_REPORT.md`, and this audit are all present and consistent. No contradictory documentation found.

This repository does not ship fake dashboards, mock AI answers, placeholder charts, or fixture fallback data presented as production. Pending capabilities are named explicitly (`pendingCapability`) with explanations and alternatives (`FRONTEND.md` §6; `docs/agents/COORDINATION.md` scope lock).

## Checks

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e:install
npm run test:e2e
```

Database work additionally:

```bash
npx supabase start     # requires Docker
npm run db:migrate
npm run db:seed
npm run test:db
```

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md), then [`AI_CONTEXT.md`](AI_CONTEXT.md) before making
changes. Branch names follow `feature/`, `fix/`, `refactor/`, `test/`, `security/`, or
`docs/`. Each phase needs approved requirements, UI flows, data contracts, and a risk review
before implementation begins.
