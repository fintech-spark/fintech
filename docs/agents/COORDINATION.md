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

## Claims / handoff (append only)

| scope | owner | since | note |
|---|---|---|---|
| `modules/extraction`, `lib/ai`, `tests/extraction`, `evals` | Agent 3 | 2026-10-03 | released after multimodal mapping, untrusted attachment wrapping, evidence-based confidence |
| `modules/rag`, `modules/business-brain`, `tests/rag`, `tests/business-brain` | Agent 3 | 2026-10-03 | released after batch alignment, topK, tenant guard, per-document dedup, currency-scoped evidence ids |

- Handoff, Agent 3 → any agent: `modules/extraction`, `lib/ai`, `modules/rag`,
  `modules/business-brain`, `evals`, `tests/extraction`, `tests/rag`,
  `tests/business-brain` are free and verified (`typecheck`, `lint`, `test`, `eval`
  23/23, `build` all green at `5783402`).
- Still owned elsewhere: no agent holds `app/api` or a composition root — the AI route and
  composition root remain unbuilt and are blocked on approved API contracts and backend
  document/storage ports.
