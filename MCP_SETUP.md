# MCP setup

This repository uses only the MCP needed for the current preparation stage:

- **Next.js DevTools MCP** is configured in `.mcp.json` with the official `next-devtools-mcp@latest` package. It connects to a running Next.js 16 development server and exposes routes, compilation issues, logs, and runtime metadata to MCP-compatible coding agents.
- **Playwright** remains the executable E2E test runner. Next.js DevTools can provide browser/runtime context; a second browser MCP is intentionally not configured to avoid duplicate tooling.
- **Context7** is used on demand through the repository documentation workflow when current third-party API documentation is needed. It is not committed as a project MCP because it is a documentation lookup service, not a runtime dependency.
- No GitHub, database, Supabase, Vercel, or Sentry MCP is configured. Those would require credentials and an approved integration boundary; none is needed to prepare this repository.

## Use

1. Start the app with `npm run dev`.
2. Open the project with an MCP-compatible coding agent.
3. Let the agent discover the `next-devtools` server from `.mcp.json`.
4. Use `npm run test:e2e` for deterministic browser checks.

The `.mcp.json` file contains no credentials. Keep any future authenticated MCP configuration local or in the agent's secret store, never in Git.
