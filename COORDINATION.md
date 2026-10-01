# Agent coordination board

**STATUS: ACTIVE ARCHITECTURE IMPLEMENTATION**

The user has explicitly assigned the task:
> "You are the senior software architect for a project called Merchant Brain and your ONLY task in this phase is to establish and implement the complete Modular Monolith / Microlith architecture for the project."

## Scope Lock (DO NOT DELETE)

The following directories and files are **explicitly required by the user's architectural mandate** and must NOT be removed or cleaned up:

- `modules/**` — All 19 logically isolated domain modules (auth, businesses, transactions, expenses, inventory, customers, suppliers, documents, ingestion, extraction, analytics, profit-leaks, cash-flow, simulator, business-brain, rag, actions, notifications, audit).
- `lib/types.ts` — Branded IDs, Result monad, Money, TenantContext, pagination.
- `lib/errors.ts` — AppError hierarchy.
- `lib/events.ts` — Typed in-process event bus.
- `lib/validators.ts` — Shared Zod schemas.
- `lib/database/**` — Database abstraction interfaces.
- `lib/ai/tools/**` — AI tool interfaces and registry.
- `lib/registry.ts` — Module DI registry.
- `lib/boundaries.ts` — Module dependency graph and boundary validation.
- `database/**` — PostgreSQL schema constants and client re-exports.
- `tests/architecture.test.ts` — Architecture invariant verification tests.

## Active Session Ownership

- **Lead Architect:** Antigravity IDE (establishing full modular monolith, types, services, repositories, barrels, verification).
- Other agents (`opencode` s006 / s011): **DO NOT RUN `rm -rf modules` or delete lib files.** Please allow the build, test, and typecheck verification to complete.
