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

**Foundation and Phase 1 (database foundation).** The architecture skeleton, database
migrations, tenant-aware client abstraction, and validation layer exist and are tested.
Product routes, authentication, uploads, and AI calls are **not** implemented.

This repository does not ship fake dashboards, mock AI answers, or placeholder data
presented as real. A demo that lies is worse than an unfinished feature.

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
