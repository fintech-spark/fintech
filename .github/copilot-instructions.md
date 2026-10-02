# Merchant Brain — GitHub Copilot instructions

**Read [`AI_CONTEXT.md`](../AI_CONTEXT.md) before doing anything in this repository.**
It is the single authoritative statement of what we are building and how. If anything below
or anywhere else contradicts it, `AI_CONTEXT.md` wins.

## What this project is

Merchant Brain is an AI-powered business operating system for small merchants in India. It
turns messy existing business data into understanding, diagnosis, simulation, and
human-approved action. Philosophy: *don't make the merchant learn software — make the
software understand the merchant.*

Architecture is a **Modular Monolith**: one repo, one deployable Next.js unit, one PostgreSQL
database, 19 isolated domain modules, in-process typed event bus. **No microservices, no
message broker.**

## Step 0 — do this before anything else

Read [`SKILLS.md`](../SKILLS.md) and load every skill that matches your task, using the
mapping table in [`.agents/workflows/skill-first.md`](../.agents/workflows/skill-first.md).
Small tasks are not exempt. `token-efficient-agent` and `multi-agent-concurrency` apply to
every task. Use available MCP tools (`context7` for current docs) rather than guessing.

## Hard rules (non-negotiable)

1. **Invent nothing.** No API, endpoint, table, column, function, package, env var, or config
   key that is not in this repository or in official documentation you actually fetched.
   No product API contracts are approved — do not create endpoints to look complete.
2. **Verify before asserting.** Source code and `package.json` beat every document. Fetch
   current official docs for any third-party API. Say "unverified" when you have not checked.
   Never claim a check passed if it was not run.
3. **The model is never the source of truth.** Deterministic code computes all money,
   quantities, dates, totals and thresholds. AI explains; it never calculates or authorizes.
4. **No fake completeness.** No mock data, fake dashboards, or placeholder AI answers. Use
   synthetic fixtures only; never real merchant or financial data.
5. **Never revert another agent's work.** Multiple agents share this repository. Claim paths
   with `.agents/tools/claim.sh` before writing, and read `COORDINATION.md`.

## Before you write code

- Search for an existing implementation first; reuse it rather than adding a second one.
- Do not add a dependency without a clear, stated reason.
- Every AI output passes Zod schema validation plus deterministic cross-field checks.
- For irreversible or financial actions: draft → validate → human approves → execute → audit.

Full detail and the document map: [`AI_CONTEXT.md`](../AI_CONTEXT.md).
