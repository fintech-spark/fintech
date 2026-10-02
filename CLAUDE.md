# Merchant Brain — Claude instructions

**Read [`AI_CONTEXT.md`](./AI_CONTEXT.md) before doing anything in this repository.** It is the
single authoritative statement of what we are building and how. On any conflict,
`AI_CONTEXT.md` wins over this file and over every other document.

Also read [`AGENTS.md`](./AGENTS.md) and the smallest relevant source files before editing.

## Summary

Merchant Brain is an AI-powered business operating system for small merchants in India —
it turns messy, fragmented business data into understanding, diagnosis, simulation, and
human-approved action. The architecture is a **Modular Monolith / Microlith**: one repository,
one deployable Next.js unit, one PostgreSQL database, 19 isolated domain modules, and an
in-process typed event bus. No microservices. No message broker. AI is provider-agnostic.

## Step 0 — mandatory, before anything else

Read [`SKILLS.md`](./SKILLS.md) (the generated index) and load **every** skill that matches
your task, using the table in [`.agents/workflows/skill-first.md`](./.agents/workflows/skill-first.md).
`token-efficient-agent` and `multi-agent-concurrency` apply to every task.

Use the MCP tools you actually have — `context7` for current third-party docs before writing
any library call, `next-devtools` for Next.js runtime state. Never claim a tool you do not have.

**The user should never have to ask for skills to be used.**

## The rules that most often get broken

- **Do not invent APIs, endpoints, tables, columns, functions, packages, or config keys.**
  If it is not in the repo or in official docs you actually fetched, it does not exist.
  No product API contracts are approved.
- **Do not invent business facts or numbers.** Deterministic code computes money; AI
  explains. Never let a model produce a figure that is presented as fact.
- **Verify, then assert.** Source code and `package.json` are ground truth. Say "unverified"
  rather than guessing. Never claim a check passed if it was not run.
- **Do not manufacture completeness.** No mock behaviour, fake dashboards, or fabricated
  data. Synthetic fixtures only.
- **Coordinate.** Multiple agents work here at once: claim paths with
  `./.agents/tools/claim.sh acquire "<prefix>" --note "<intent>"` before writing, and read
  `COORDINATION.md`. Never revert another agent's work; there is no git remote, so history is
  unrecoverable.
- **Every business claim needs a supporting source reference**, and the cited text must
  actually support it.

Detail, document map, and roadmap: [`AI_CONTEXT.md`](./AI_CONTEXT.md).
