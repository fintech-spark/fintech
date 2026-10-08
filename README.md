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

```text
DATA → UNDERSTANDING → DIAGNOSIS → SIMULATION → DECISION → ACTION
```

## Architecture

A **modular monolith**: one repository, one deployable Next.js unit, one PostgreSQL database,
19 isolated domain modules, and an in-process typed event bus. No microservices, no message
broker. AI is provider-agnostic.

The rule the whole design protects:

| Layer | Owns |
| --- | --- |
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
| --- | --- |
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
- Vitest for unit/integration and runnable AI evals, Playwright for E2E
- ESLint, CodeQL, Semgrep, Gitleaks, and Dependabot in CI

## Status

Snapshot: **2026-10-05**. Historical audit files describe earlier code and are not current completion evidence.

- **Documents:** real bounded multipart upload to private storage, persisted extraction/evidence, corrected review, atomic approved invoice/expense promotion, duplicate handling and excerpt-based RAG indexing.
- **Actions:** persisted draft/submission/approval/expiry/cancellation/execution history, distinct approver and owner-only execution, durable idempotency and atomic internal report/price/supplier effects. External messaging and reorder adapters remain unsupported.
- **Business Brain:** verified tenant membership, bounded read-only tools, tenant-scoped retrieval, real evidence/query snapshots, strict output/citation validation and durable user-scoped conversation history. Provider/output failures surface a degraded deterministic answer.
- **Security:** tenant-scoped repositories and RLS, recipient-scoped notifications, atomic business provisioning, immutable approved document provenance, trusted-origin mutation checks and opt-in read-only demo behavior. Privileged raw PostgreSQL still requires explicit repository tenant predicates; a query-text heuristic is not a security boundary.
- **Verification:** database-enabled unit/integration checks, live PostgreSQL tests, production build, offline AI evaluations, live synthetic Google evaluations and production-bundle Chromium journeys have passing runs. Browser journeys use a synthetic HTTP backend; they do not prove the entire hosted storage/provider path.

Deployment, hosted migration state, external adapters and full live merchant journeys remain unverified. Development-only dependency advisories remain open; the production dependency audit is clean. See [the verification record](docs/engineering/production-integration-verification.md) for commands, evidence and limitations.

## Checks

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run eval
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
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres npm run test:db:live
```

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md), then [`AI_CONTEXT.md`](AI_CONTEXT.md) before making
changes. Branch names follow `feature/`, `fix/`, `refactor/`, `test/`, `security/`, or
`docs/`. Each phase needs approved requirements, UI flows, data contracts, and a risk review
before implementation begins.
