# Merchant Brain — Gemini / Antigravity instructions

**Read [`AI_CONTEXT.md`](./AI_CONTEXT.md) before doing anything in this repository.** It is the
single authoritative statement of what we are building and how. On any conflict,
`AI_CONTEXT.md` wins over this file and over every other document in the repository.

Also read [`AGENTS.md`](./AGENTS.md), `docs/agents/COORDINATION.md`, and the project rules under
`.agents/rules/` before writing.

## Summary

Merchant Brain is an AI-powered business operating system for small merchants in India. It
turns messy, fragmented business data — invoices, receipts, UPI records, WhatsApp, expenses,
inventory, spreadsheets — into understanding, diagnosis, simulation, and human-approved
action. Philosophy: *don't make the merchant learn software — make the software understand
the merchant.*

**Architecture: Modular Monolith / Microlith.** One repository, one deployable Next.js unit,
one PostgreSQL (Supabase) database, 19 isolated domain modules, in-process typed event bus.
No microservices, no broker. AI is provider-agnostic (Gemini / Claude / OpenAI).

**Layer rule:** PostgreSQL holds the facts, analytics computes the numbers, RAG supplies
context, AI explains, tools access data under an allowlist, humans approve, audit records.
Never collapse these.

## Step 0 — mandatory skill triage

Before your first action on any task, read [`SKILLS.md`](./SKILLS.md) and load every skill
matching the task, per the table in
[`.agents/workflows/skill-first.md`](./.agents/workflows/skill-first.md). Small tasks are not
exempt. `token-efficient-agent` and `multi-agent-concurrency` apply to every task.

Then use the MCP tools available to you (`context7` for current docs, `next-devtools` for
Next.js runtime state) instead of guessing. Never claim a tool you do not have.

## Hard rules

1. **Invent nothing** — no API, endpoint, table, column, function, package, env var, or config
   key absent from the repository or from official documentation you actually fetched. No
   product API contracts are approved; do not create endpoints to appear complete.
2. **Never let the model be the source of truth** for arithmetic, balances, totals, tenant
   identity, permissions, or irreversible actions. Deterministic code computes; AI explains.
3. **Verify before asserting.** Source and `package.json` beat documents. Fetch current docs
   for third-party APIs. Report "unverified" instead of guessing. A skipped or failed check
   is never a pass.
4. **No fake completeness** — no mock behaviour, fabricated data, or filler to hide failure.
   Synthetic fixtures only; never real merchant, personal, or financial data.
5. **Coordinate writes.** Multiple agents share this repository. Before writing, run
   `./.agents/tools/claim.sh acquire "<path-prefix>" --note "<intent>"` and never write to a
   path you have not claimed. Never revert another agent's work; there is no git remote.
6. **Every AI output is validated** by Zod plus deterministic cross-field invariants, and
   every business claim carries at least one source reference that actually supports it.

Full detail, the 19 modules, team workstreams, roadmap, and the document map:
[`AI_CONTEXT.md`](./AI_CONTEXT.md).
