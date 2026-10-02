# Merchant Brain project memory

> **This file is a memory aid, not the source of truth.** Read
> [`AI_CONTEXT.md`](./AI_CONTEXT.md) first — it is the authoritative statement of scope,
> architecture, and agent conduct. Where this file disagrees with it, `AI_CONTEXT.md` wins.

## Project identity

- **Name:** Merchant Brain
- **Purpose:** An AI-powered business operating system for small merchants in India — turning the messy data they already have into understanding, diagnosis, simulation, and human-approved action.
- **Current status:** Architecture foundation in place; **Phase 1 (Database Foundation) has begun**. Product routes, auth, uploads, AI calls, and production data are still not implemented.

## Current stack

- Next.js 16.3.8 App Router, React 19.3.0, TypeScript 6.0.3, Tailwind CSS 4.3.3.
- shadcn/ui current Radix base, `radix-ui`, Lucide React, Recharts, React Hook Form, Zod.
- Vercel AI SDK with official Google, Anthropic, and OpenAI provider packages prepared but not configured.
- Vitest and Playwright Test; ESLint with `eslint-config-next` and `@shadcn/lint`.
- npm 11.16.0 and Node 24.18.0 pinned by `packageManager`/`.nvmrc`.

## Important paths

| Topic | Files |
|---|---|
| Agent instructions | `AGENTS.md`, `AI_RULES.md`, `AI_EVIDENCE_RULES.md` |
| Design | `DESIGN_SYSTEM.md`, `components.json`, `components/ui/` |
| AI prep | `MODEL_STRATEGY.md`, `lib/ai/`, `prompts/`, `evals/` |
| Security | `SECURITY.md`, `FILE_SECURITY.md`, `AI_ACTION_POLICY.md`, `API_RULES.md` |
| Checks | `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tests/` |
| CI/security | `.github/workflows/`, `.github/dependabot.yml`, `.mcp.json` |
| Product direction | `PRODUCT_SPEC.md`, `ROADMAP.md` |

## Current route

`app/page.tsx` is a neutral setup verification page. It is not a dashboard or product feature.

## Durable rules

- Source code/package metadata wins over memory.
- Inspect before editing, reuse existing code, avoid dependency bloat, verify official APIs, and report actual checks only.
- Application data and deterministic calculations are the source of truth; AI outputs require schema validation and evidence.
- The architecture **is decided**: Modular Monolith / Microlith — one repository, one deployable Next.js unit, one PostgreSQL database, 19 isolated domain modules, in-process typed event bus. See `AI_CONTEXT.md` §4. Do not relitigate it and do not introduce microservices or a message broker.

## Last setup summary

The previously empty directory was audited and prepared with a minimal Next.js foundation, package lockfile, shadcn/Radix setup, agent skills, MCP configuration, docs, prompts/evals/fixtures scaffolding, CI/security workflows, and synthetic verification checks.

**Superseded:** the earlier "next approved step is requirements and UI-flow review, not product implementation" note no longer reflects the project. The modular-monolith architecture mandate is approved and Phase 1 (Database Foundation) is underway — see `AI_CONTEXT.md` §9 and §11.
