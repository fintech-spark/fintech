# Merchant Brain — documentation

Everything that governs how this project is built, planned, and reviewed. Read the file your
task needs — this page is the map, not a reading list.

## Start here

| File | Why |
| --- | --- |
| [`../AI_CONTEXT.md`](../AI_CONTEXT.md) | **The authoritative statement of what we are building and how.** It wins on conflict. Read it first |
| [`../AGENTS.md`](../AGENTS.md) | Agent instructions and the mandatory Step 0 skill triage |
| [`../SKILLS.md`](../SKILLS.md) | The generated skill index — read this to decide which skills to load |
| [`../.agents/workflows/skill-first.md`](../.agents/workflows/skill-first.md) | The task-to-skill mapping table |

## Product

| File | Contents |
| --- | --- |
| [`product/PRODUCT_SPEC.md`](product/PRODUCT_SPEC.md) | Problem, target user, what we are and are not building |
| [`product/ROADMAP.md`](product/ROADMAP.md) | The 14 phases and the gate before each one |
| [`product/DESIGN_SYSTEM.md`](product/DESIGN_SYSTEM.md) | Design tokens, components, and UI conventions |

## AI

| File | Contents |
| --- | --- |
| [`ai/AI_RULES.md`](ai/AI_RULES.md) | Reliability rules: what a model may and may not be trusted with |
| [`ai/AI_EVIDENCE_RULES.md`](ai/AI_EVIDENCE_RULES.md) | The claim envelope and evidence requirements |
| [`ai/AI_ACTION_POLICY.md`](ai/AI_ACTION_POLICY.md) | Authority limits and prohibited actions |
| [`ai/MODEL_STRATEGY.md`](ai/MODEL_STRATEGY.md) | Role-based model routing and provider rules |
| [`ai/AI_COSTS.md`](ai/AI_COSTS.md) | Budgets, limits, and cost discipline |
| [`ai/AI_BRAIN.md`](ai/AI_BRAIN.md) | Project memory — a memory aid, not a source of truth |

## Engineering

| File | Contents |
| --- | --- |
| [`engineering/DATABASE.md`](engineering/DATABASE.md) | Schema, table groups, client abstraction, migrations |
| [`engineering/DATABASE_DECISIONS.md`](engineering/DATABASE_DECISIONS.md) | Phase 1 tradeoffs and why they were chosen |
| [`engineering/API_RULES.md`](engineering/API_RULES.md) | API contract rules (no unapproved endpoints) |
| [`engineering/ERROR_HANDLING.md`](engineering/ERROR_HANDLING.md) | Error taxonomy and propagation |
| [`engineering/TESTING.md`](engineering/TESTING.md) | Test strategy and what counts as a pass |
| [`engineering/EVALS.md`](engineering/EVALS.md) | AI evaluation protocol (Promptfoo, graders, review) |
| [`engineering/OBSERVABILITY.md`](engineering/OBSERVABILITY.md) | Logging, telemetry, tracing |
| [`engineering/SETUP_AUDIT.md`](engineering/SETUP_AUDIT.md) | Baseline audit record. **Historical — its scope claims are superseded by `AI_CONTEXT.md`** |
| [`engineering/REPO_STRUCTURE.md`](engineering/REPO_STRUCTURE.md) | Canonical directory map, branch model, and file-layout invariants |
| [`engineering/FRONTEND.md`](engineering/FRONTEND.md) | **Merchant-facing interface: layers, data states, the approval boundary, tenant safety, testing** |
| [`engineering/PART1_PART2_EXECUTION_REPORT.md`](engineering/PART1_PART2_EXECUTION_REPORT.md) | **Execution and verification report for Part 1 & Part 2 core stabilization and capabilities** |

## Security

| File | Contents |
| --- | --- |
| [`../SECURITY.md`](../SECURITY.md) | Security policy (root, because GitHub links it) |
| [`security/FILE_SECURITY.md`](security/FILE_SECURITY.md) | Upload limits, MIME/magic-byte validation, formula injection |
| [`security/GITHUB_SECURITY.md`](security/GITHUB_SECURITY.md) | Branch protection, GHAS, owner actions |

## Agents

| File | Contents |
| --- | --- |
| [`agents/COORDINATION.md`](agents/COORDINATION.md) | The claim protocol so concurrent agents do not clobber each other |
| [`agents/DEFINITION_OF_DONE.md`](agents/DEFINITION_OF_DONE.md) | The per-change acceptance checklist |
| [`agents/MCP_SETUP.md`](agents/MCP_SETUP.md) | Which MCP servers are used, which are rejected, and why |

## Why some files are not in `docs/`

These stay at the repository root because a tool or GitHub itself looks for them there:

| File | Required at root because |
| --- | --- |
| `README.md` | GitHub renders it on the repository home page |
| `CONTRIBUTING.md`, `SECURITY.md` | GitHub links these from the repo UI |
| `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `AI_CONTEXT.md` | Each coding agent looks for its own file at the project root |
| `SKILLS.md` | Referenced by every entry point above as the first thing an agent reads |

The root also holds the usual project configuration (`package.json`, `tsconfig.json`,
`next.config.ts`, ESLint/PostCSS/Vitest/Playwright configs, `.mcp.json`, `skills-lock.json`).
