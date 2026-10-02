---
description: Mandatory entry workflow for every task in this repository. Loading the right skills and using the right MCP tools is a required first step, not a user request.
---

# Skill-first workflow

**Every task starts here.** This workflow is mandatory and is not skipped for small tasks,
quick fixes, or "obvious" changes. The user should never have to say "use the skills".

The point is not ceremony. The skills in `.agents/skills/` encode decisions this project has
already made, and the MCP servers give access to facts that would otherwise be guessed.

---

## Step 0 — Skill triage (before anything else)

1. **Read [`SKILLS.md`](../../SKILLS.md)** — the generated one-line-per-skill index. It costs
   a few hundred tokens; loading every skill body would cost tens of thousands.
2. **Find your row** in the mapping table below.
3. **Load every matching skill** before planning or editing.

Loading a relevant skill is *cheaper* than re-deriving its content and produces work that
matches the project's decisions instead of contradicting them.

### Task → skill mapping

| If the task involves… | Load these |
|---|---|
| **Anything at all** | `token-efficient-agent` |
| **Any write in this repo** | `multi-agent-concurrency` |
| Schema, tables, indexes, migrations, queries | `database-design`, `supabase-postgres-best-practices` |
| RLS, tenant isolation, multi-tenancy, authorization | `saas-multi-tenant` |
| Supabase auth, sessions, protected routes | `nextjs-supabase-auth` |
| API routes, endpoints, request/response shapes | `api-design`, `api-security` |
| Backend services, repositories, module boundaries | `backend-patterns` |
| AI features, providers, prompts, model routing | `ai-sdk`, `prompt-optimizer` |
| Extraction, embeddings, retrieval, pgvector | `rag-engineer`, `iterative-retrieval` |
| Evals, Promptfoo, graders, LLM-as-judge | `eval-harness`, `advanced-evaluation` |
| UI, components, styling, layout | `shadcn`, `vercel-react-best-practices`, `vercel-composition-patterns` |
| UI review, accessibility, UX audit | `web-design-guidelines` |
| Auth, input handling, secrets, webhooks | `security-review` |
| New architecture, new third-party integration | `threat-modeling` |
| Verifying a change at runtime (`next dev` running) | `next-dev-loop` |
| Before reporting a task complete | `verification-loop`, `e2e-testing` |
| Recording an architectural decision | `architecture-decision-records` |

A task can match several rows. Load all of them.

### Non-negotiable pair

`token-efficient-agent` and `multi-agent-concurrency` apply to **every** task. Load them
first — they govern how the rest of the work is done.

---

## Step 1 — Tool triage (MCP)

Check what is actually available, then use it rather than guessing. **Never claim a tool
exists that is not in your tool list.**

| Need | Tool | Rule |
|---|---|---|
| Current docs for any third-party API | `context7` | **Always** use this before writing library calls. Do not write provider, Supabase, or AI SDK calls from memory |
| Routes, compile errors, runtime errors, build state | `next-devtools` | Requires `npm run dev` running. Ask for the port if auto-discovery fails |
| Multi-step design or debugging | `sequentialthinking` | Use when a problem genuinely has branches; skip for simple lookups |

If a needed MCP server is absent, **say so** and fall back to reading official docs on the
web. Do not silently work from memory.

---

## Step 2 — Claim your scope

Before the first write:

```bash
./.agents/tools/claim.sh acquire "<path-prefix>" --note "<intent>" --ttl 1800
```

Never write to a path you have not claimed. `./.agents/tools/claim.sh status` shows who is
active. Release when done, even on failure. See `docs/agents/COORDINATION.md`.

---

## Step 3 — Do the work

Follow the project rules: reuse before creating, no dependency without a stated reason, no
invented APIs or data. Read [`AI_CONTEXT.md`](../../AI_CONTEXT.md) §10 if anything is unclear.

---

## Step 4 — Verify

Load `verification-loop`. Run the checks the change actually warrants, and report what you
ran and what you skipped. **A skipped or failed check is never a pass.**

---

## Step 5 — Report

State what changed, what you ran, what passed, what you skipped, and what is unverified.
Release your claim.

---

## Why this is enforced

Without this step, agents in this repository have: invented endpoints that were never
approved, written numbers that should have come from deterministic code, duplicated
abstractions that already existed, and reported checks they never ran.

Each of those is a skill or a rule that was available and not loaded.

**If you are an agent reading this: Step 0 is not optional. Do it first.**
