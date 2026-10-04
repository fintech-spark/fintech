---
name: module-architecture
description: Add a domain module, wire services, publish or consume domain events, or import across module boundaries. Use when creating a file under modules/, adding a repository or service, touching lib/boundaries.ts, lib/registry.ts, lib/events.ts, lib/http/wiring.ts, or lib/ai/composition.ts, or when an import is rejected or a circular dependency appears. Explains the 19-module microlith, barrel imports, the composition roots, and the undeclared-module quarantine.
---

# Module architecture

One repository, one deployable Next.js unit, one PostgreSQL database, **19 isolated domain
modules**, in-process typed event bus. No microservices, no broker.

## Layout

```
modules/<name>/
├── domain/          # pure rules and types — no I/O, no framework imports
├── application/     # use cases, orchestration
├── infrastructure/  # repositories, clients, I/O
└── index.ts         # the ONLY public surface
```

Cross-module imports go through the barrel: `import { X } from '@/modules/<name>'`. Deep imports
like `@/modules/documents/domain/types` (used in three `extraction` files) bypass the boundary and
are a known wart — do not add more.

## Enforcement is test-only — and that is a trap

`lib/boundaries.ts` declares `MODULE_DEPENDENCIES`, plus `isAllowedImport` and
`detectCircularDependencies`. **Both are pure functions called only from tests**
(`tests/architecture.test.ts`, `tests/smoke.test.ts`, `tests/intelligence/sql-and-boundaries.test.ts`).
There is no ESLint rule and no build-time check, so `npm test` skipping or failing silently voids
the constraint.

**Adding a module requires adding it to `MODULE_DEPENDENCIES`.** Skip that and
`isAllowedImport` returns `false` for *every* edge out of it — a silent quarantine. `evidence` and
`validation` are in exactly this state today.

## Composition roots

There is no DI container. Three factory functions are called directly from route handlers:

| Factory | Builds | Called by |
|---|---|---|
| `wire(accessToken)` / `wireClient(db)` (`lib/http/wiring.ts:54,64`) | 7 `Default*Service` over `Postgrest*Repository` (RLS) | 44 route files |
| `wireIntelligence(businessId)` (`lib/http/wiring.ts:94`) | analytics, cash-flow, profit-leaks, simulator, actions, notifications over raw `pg` | 11 routes |
| `wireBusinessBrain(businessId)` (`lib/ai/composition.ts:25`) | 11 read-only AI tools + context assembler | the single `ai/chat` route |

Add new dependencies here, not in a module. `lib/registry.ts` (`registerModule`/`getModule`) is
**dead code with zero callers** — and worse, it lists `auth`, `ingestion`, and `audit` as real
capabilities when all three are interface-only stubs (8-9 lines, no implementing class). Do not
treat it as the capability surface, and do not extend it without implementing.

## Event bus

`lib/events.ts` — 11 typed events, `createEventBus()`, module singleton `eventBus`, fire-and-await.

Current reality: only `actions` and `profit-leaks` publish; only `notifications` subscribes via
`subscribeIntelligenceAlerts` — and **that is never called outside tests**, so no notification rows
are written from domain events in production. Failure is silent (no subscriber = no-op). 6 of 11
events have no publisher at all.

If you rely on an event, verify a production subscriber exists. Do not assume the bus is wired.

## Stub modules — do not treat as real

`auth`, `ingestion`, `audit` are interface-only. `evidence` is a self-declared synthetic stub.
`validation` has 362 LOC but no `index.ts` and no consumers beyond one eval file. When a task
appears to need one of these, document the dependency rather than filling the gap inside an
unrelated module.

## Gotchas

- Keep `domain/` pure: no `process.env`, no Supabase, no `fetch`. It is the part that must be
  trivially testable.
- Money crosses module boundaries as `Money` (integer minor units), never as a formatted string.
- `detectCircularDependencies` marks nodes visited before exploring and never unmarks on return, so
  a diamond can produce a false-positive cycle. Tests pass today; treat a new cycle report with
  suspicion before restructuring.
- AI extraction writes through `documents.updateStatus` — it owns no repository. Keep it that way.

## Validation

```bash
npx vitest run tests/architecture.test.ts tests/smoke.test.ts tests/intelligence/sql-and-boundaries.test.ts
npm run typecheck
```

Those three files are the boundary enforcement. Run them after any structural change — and never
skip them, because nothing else checks.
