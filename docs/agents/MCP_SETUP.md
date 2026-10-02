# MCP setup

Which Model Context Protocol servers this project uses, which it deliberately does not, and
why. Scope decisions here are architectural: see [`AI_CONTEXT.md`](./AI_CONTEXT.md) §4.

## Configured for this repository

- **Next.js DevTools MCP** — configured in [`.mcp.json`](./.mcp.json) with the official
  `next-devtools-mcp@latest` package. It connects to a running Next.js 16 development server
  and exposes routes, compilation issues, logs, and runtime metadata to MCP-compatible coding
  agents. Requires `npm run dev`; needs no credential.
- **Context7** — used on demand through the documentation workflow when current third-party
  API documentation is needed. It is a documentation lookup service, not a runtime
  dependency, so it is not committed as a project MCP.

## Deliberately not configured

- **A second browser MCP.** Playwright remains the single executable E2E runner. Next.js
  DevTools already supplies browser/runtime context, and adding a browser MCP would duplicate
  tooling and split the source of truth for browser state.
- **A PostgreSQL MCP, for now.** This is a considered decision, not an oversight:
  - `@modelcontextprotocol/server-postgres` is **officially deprecated**.
  - The remaining options are unvetted third-party servers (`postgres-mcp`,
    `@henkey/postgres-mcp-server`). Any Postgres MCP receives **full database credentials and
    unrestricted query access**, and this database will hold multi-tenant merchant financial
    data. Adding an unvetted server to that boundary is a supply-chain risk the project's own
    rules (`SECURITY.md`, `AGENTS.md`) do not permit.
  - Nothing is lost today: there is no `DATABASE_URL` and no live database yet.
  - **Revisit when** Supabase ships a first-party Postgres path, or once a specific
    third-party server has been reviewed and accepted as a dependency.
- **GitHub, Vercel, and Sentry MCPs.** Each requires credentials and an approved integration
  boundary, and none is needed at the current phase.

## Recommended next addition — Supabase MCP (first-party)

Phase 1–2 work (database foundation, RLS, tenant isolation) is where a database MCP earns its
place. Prefer the **first-party** server:

```bash
npx -y @supabase/mcp-server-supabase@latest --access-token=<TOKEN>
```

Verified package: `@supabase/mcp-server-supabase` (bin `mcp-server-supabase`). A hosted
endpoint also exists at `https://mcp.supabase.com/mcp`.

**Before adding it, decide and record:**

1. Which Supabase project the token is scoped to, and whether it is a **read-only** token.
2. That the token is stored in the agent's local secret store — never in Git, never in
   `.mcp.json`, never in a committed example file.
3. That agents must not run destructive migrations against a shared or production database
   through it. Schema changes go through reviewed migration files.

Until those are settled, do not add it.

## Agent-side configuration

Credentialed MCP configuration belongs to the individual agent's local setup, never in this
repository (see the rule below). Locally configured servers currently include `next-devtools`,
`context7`, and `sequential-thinking`. They are conveniences for whoever is driving; they are
not project dependencies and no code may assume they exist.

## Use

1. Start the app with `npm run dev`.
2. Open the project with an MCP-compatible coding agent.
3. Let the agent discover the `next-devtools` server from `.mcp.json`.
4. Use `npm run test:e2e` for deterministic browser checks.

## Credential rule

The `.mcp.json` file contains no credentials. **Keep any authenticated MCP configuration
local, or in the agent's secret store — never in Git.** An MCP server is an ambient authority:
it can act with the credentials it is given, so treat its token scope as part of the security
boundary, not as a convenience setting.
