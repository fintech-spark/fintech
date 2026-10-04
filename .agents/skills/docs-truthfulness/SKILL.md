---
name: docs-truthfulness
description: Write or update project documentation that matches the code. Use when editing README.md, AI_CONTEXT.md, AGENTS.md, CLAUDE.md, docs/**, audit or report files, or when a doc makes a claim about implemented behaviour. Also use when you notice a doc contradicting the code. Encodes the AI_CONTEXT.md authority order and the specific stale claims currently in the repo.
---

# Documentation truthfulness

This repo has a documented conflict policy (`AI_CONTEXT.md`, "Conflict and staleness policy"), and
a real history of docs drifting ahead of code. A doc that overstates what works is worse than no doc.

## Authority order

1. `AI_CONTEXT.md` — scope, architecture, agent conduct. Wins over everything.
2. **Source code and `package.json`** — what actually exists.
3. The topical doc for its own subject (`docs/ai/`, `docs/security/`, …).
4. Everything else, including memory and prior reports.

If a doc contradicts the code: do not delete it and do not follow it. Fix it or report it, and say
which one you changed.

## Rules for claims

- Mark unverified work as unverified. "Implemented, not exercised against a live provider" is
  useful; "working" without a run is not.
- Never describe a stub as a feature. `auth`, `ingestion`, and `audit` are interface-only; `evidence`
  is a synthetic stub; RAG retrieval is not wired in production.
- Numbers come from commands you ran, with the command shown.
- State the environment when it matters (live DB vs static test vs mocked provider).

## Currently stale — fix or flag when you touch these

| Claim | Reality |
|---|---|
| `README.md` "RAG context" | **Corrected.** `wireBusinessBrain` connects `PgChunkStore` + `DefaultRAGService` with `ProviderEmbeddingProvider` when an adapter is present, and the README reflects this |
| `DATABASE_SECURITY_AUDIT.md` auth/authz rows | **Corrected.** Superseded, pointing at `lib/http/auth-context.ts` |
| commit `144b8fa` / `WAVE1_REDO_REPORT.md:56` "structured output enforced" | Superseded: the adapter now routes a caller-supplied Zod schema to `Output.object({ schema })` and fails closed on empty output. The historical report still describes the old state — treat it as history, not documentation |
| `AUTHORIZATION_MATRIX.md` | **Corrected.** Documents both the application-layer permission matrix (`lib/http/auth-context.ts`) and RLS policies, explicitly noting that `actions:execute` is owner-only |

A stale claim gets fixed once, in the same change that makes it false. If you fix a defect and a
document described it as broken, update that document too — a skill that reports a fixed bug as
open is its own kind of lie.

## Generated files — do not hand-edit

- `SKILLS.md` — regenerate with `.agents/tools/skills-index.sh` after adding/renaming a skill.
- `SKILLS.md`'s "Use when" column is the agent's discovery surface: keep descriptions activation-oriented.

## House style

- Kebab-case filenames; `PascalCase` components/types; `camelCase` functions; snake_case SQL.
- Lead with what the reader must do or know; no preamble, no restating the heading.
- Reference real paths (`lib/http/auth-context.ts:138`) instead of describing things abstractly.
- Record decisions as ADRs in `docs/adr/` (see the `architecture-decision-records` skill) rather
  than growing a new top-level report file. The repo root currently has 8 report files; resist adding
  a ninth.

## Validation

```bash
./.agents/tools/skills-index.sh                    # if you touched skills
./.agents/tools/validate-skills.mjs                # if you touched skills
npm run lint && npm run typecheck                  # if you touched code the doc describes
```

## References

- `AI_CONTEXT.md` §10.1-10.3 (never invent, never fabricate completeness), §Conflict policy
- `.agents/workflows/skill-first.md` — the skill triage workflow
