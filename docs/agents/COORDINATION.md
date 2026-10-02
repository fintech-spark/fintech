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

## Concurrent-write protocol (path claims)

Several agents have already written to this repository at the same time, and one deleted a
tracked file (`docs/agents/COORDINATION.md` history). Before writing **anything**, take an atomic lease
on the paths you will touch. This is not optional.

```bash
CLAIM=.agents/tools/claim.sh

$CLAIM status                        # who is active right now
$CLAIM acquire "src/api" --note "adding pagination" --ttl 1800
$CLAIM check "src/api/routes.ts"     # exit 0 free, exit 1 held by someone else
$CLAIM heartbeat                     # extend the lease on long work
$CLAIM release                       # release every lease you hold
```

- Scope is a **path prefix**: `src/api` overlaps `src/api/routes.ts` but not `src/db`.
  `"*"` means the whole repository and blocks every other agent.
- Leases live in `.agents/claims/` (git-ignored, per-machine) and **expire**, so a crashed
  agent cannot block the repository. Heartbeat work that outlives its TTL.
- If `acquire` is denied it prints the holder, its scope, and its note. Do not override it.
- The tool is committed at `.agents/tools/claim.sh` so every agent runs one version.

### Hard rules

- **Never write to a path you have not claimed.**
- **Never revert another agent's work.** No `git checkout -- .`, `git reset --hard`,
  `git clean`, or `rm -rf` on shared paths. A deleted tracked file may be mid-refactor —
  report it, do not restore it unilaterally.
- Never force-push. There is no git remote, so local history is unrecoverable.
- Append to this board; never rewrite another agent's claim row.

### When the tree changes under you

Stop writing. Run `$CLAIM status` and `git status`. Report the concrete facts — the path,
what changed, timestamps you observed, and any overlapping claim — then let the human
arbitrate. Never guess another agent's intent.

Full protocol: the `multi-agent-concurrency` skill in `.agents/skills/`.

## Handoff — Agent 5 (frontend), `feature/frontend`

Recorded per the append-only rule above. Nothing here rewrites another agent's row.

### Claims taken and released

| scope | note | state |
|---|---|---|
| `app` | merchant app shell, routes, page compositions | released |
| `components` | design system + business components | released |
| `lib/api` | typed API client for approved backend contracts | released |
| `lib/format` | money / date / status presentation | released |
| `tests/frontend` | frontend unit + security tests | released |
| `tests/e2e` | E2E merchant journeys and the synthetic backend | released |
| `docs/engineering`, `docs/product`, `docs/agents` | documentation | released |
| `playwright.config.ts` | point the server-side fetcher at the E2E stub backend | released |
| `tsconfig.json`, `eslint.config.mjs` | exclude nested agent worktrees | released |

### Shared files changed — read before merging

Three files outside the frontend's own scope were changed. Each was claimed
first and each is the smallest change that unblocks the frontend:

| File | Change | Why |
|---|---|---|
| `tsconfig.json` | `exclude` now lists `fintech-ai`, `fintech-backend`, `fintech-intelligence`, `fintech-security` | Those are **nested git worktrees for other agents**, untracked here. `include: ["**/*.ts"]` was typechecking their in-progress code and reporting *their* errors as ours, which broke `npm run typecheck` and `npm run build` |
| `eslint.config.mjs` | the same directories plus `.obsidian/**` added to `globalIgnores` | ESLint was reporting 22,000+ problems from other agents' worktrees |
| `playwright.config.ts` | `webServer` now runs `npm run build && npm run start`, and passes `API_INTERNAL_BASE_URL` | E2E runs against real production output, and the server-side fetcher needs a reachable backend |

**If the nested worktrees are moved out of the repository root, these three
exclusions can be deleted.** They are a workaround for the current layout, not
a permanent architecture decision.

### Safe to take next

- `modules/*/application/service.ts` — unchanged by this agent.
- `app/api/**` — untouched. Agent 1 owns it.
- `lib/api/**` is server-only by construction. A Client Component must import
  from `@/lib/api/errors` or `@/lib/api/pending` directly, never the barrel.

### What the frontend is waiting on

`lib/api/pending.ts` is the authoritative list of capabilities with no approved
backend route: analytics roll-ups, profit leaks, cash flow, simulator, Business
Brain, actions, notifications, audit, evidence, document upload, the expense
ledger and the sales ledger. Each entry names the owning workstream. When a
route lands, delete the entry and build the screen against the real contract —
do not fill the gap with a placeholder.
