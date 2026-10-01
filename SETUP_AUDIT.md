# Merchant Brain setup audit

**Audit date:** 2026-10-01 (re-verified and reconciled 2026-10-02)  
**Scope:** repository preparation only. Product implementation was not started.

## Executive summary

The inspected directory was not an application repository. Before this task it contained project-memory files (`AI_BRAIN.md`, `AI_RULES.md`, `SESSION_MEMORY.md`), an empty README, and no source, manifest, lockfile, Git metadata, tests, CI, or deployment configuration. There was no working product code to preserve or rewrite.

This task establishes a small, neutral Next.js foundation so the requested checks can run. The root route is explicitly a setup verification page, not a Merchant Brain feature.

## Baseline findings before changes

| Area | Finding |
|---|---|
| Repository | No `.git` directory, branch, history, or remote was present. |
| Package manager | Undetermined; no `package.json` or lockfile. npm was available; pnpm and Bun were not. |
| Runtime | Node `v24.18.0`, npm `11.16.0`, Yarn `1.22.22`. No version pin. |
| Framework | None evidenced. No React, Next.js, TypeScript, Tailwind, routes, or components. |
| API/backend | None. No API routes, database, auth, storage, or service code. |
| Tests | None. No unit, integration, E2E, fixtures, or test runner. |
| CI/CD | None. No GitHub workflows, deployment config, Docker, or hosting metadata. |
| Security hygiene | No `.gitignore`, `.env.example`, secret scan, dependency policy, or security workflow. |
| Agent guidance | Memory files contained placeholders and token-reading guidance, but no project-specific engineering rules. |

## Prepared stack (actual package manifest)

- Next.js `16.3.8` with App Router, React `19.3.0`, and React DOM `19.3.0`.
- TypeScript `6.0.3`, ESLint `9.39.5`, `eslint-config-next` `16.3.8`, and Tailwind CSS `4.3.3` through `@tailwindcss/postcss`.
- shadcn CLI `4.21.1`, shadcn's current Radix-based preset, `radix-ui` `1.6.7`, `class-variance-authority`, `cn`, `tw-animate-css`, and Lucide React.
- Vercel AI SDK `7.0.126` plus official Google, Anthropic, and OpenAI provider packages.
- Zod `4.6.5`, React Hook Form `7.89.0`, `@hookform/resolvers` `5.9.1`, and Recharts `3.10.1`.
- Vitest `5.0.3` with V8 coverage and Playwright Test `1.63.0`.
- `@shadcn/lint` `0.2.0` with the TypeScript parser.

Exact versions are recorded in `package-lock.json`; ranges are intentionally kept in `package.json` so Dependabot can propose updates.

## Scripts and checks

| Script | Purpose |
|---|---|
| `npm run dev` | Start the neutral Next.js development route. |
| `npm run lint` | ESLint with Next.js, TypeScript, and shadcn/lint rules. |
| `npm run typecheck` | TypeScript no-emit check. |
| `npm test` | Vitest unit/smoke tests. |
| `npm run test:coverage` | Vitest with V8 coverage. |
| `npm run test:e2e` | Playwright E2E checks; the config starts Next dev. |
| `npm run build` | Production Next.js build. |
| `npm run security:audit` | `npm audit --audit-level=high`. |
| `npm run verify:setup` | Lint, typecheck, unit tests, and build. |

## Deliberate setup choices

- npm is the package manager because it was available and no existing choice existed. `packageManager` and `.nvmrc` make this reproducible.
- The project uses Next.js 16's current flat ESLint configuration. `next lint` is not used because it was removed in Next.js 16.
- shadcn was initialized with the current Radix base and Lucide icons. Only a neutral Button component and `lib/utils.ts` were generated; no product UI was built.
- AI provider IDs and credentials are intentionally blank. The installed provider packages are preparation, not a claim that a model is configured.
- Sentry, Promptfoo, Semgrep, CodeQL, and Gitleaks are prepared through documentation/workflows rather than adding unused runtime code or cloning reference repositories.
- `.mcp.json` contains only the official Next.js DevTools MCP, which needs a running Next.js 16 dev server and no credential.

## Gaps and risks

1. **No product implementation exists by design.** Authentication, persistence, uploads, tenant isolation, API contracts, and AI calls remain future work.
2. **No Git remote exists.** Git was initialized for local review safety, but a remote and branch policy still require team ownership.
3. **The Node/npm versions are local observations.** CI must use the same supported Node line and update the pin deliberately.
4. **ESLint 9 is used for compatibility.** The installed Next.js ecosystem and plugins currently resolve to the ESLint 9 line even though a newer ESLint major is visible in the registry; do not force ESLint 10 without checking `eslint-config-next` and plugin support.
5. **Credentials are not configured.** AI calls, Sentry, hosted Promptfoo providers, and GitHub security reporting need separately managed secrets.
6. **Security workflows are configuration, not proof of a secure deployment.** Branch protection and GitHub Advanced Security settings must be enabled in the GitHub organization/repository.
7. **Playwright browsers may not be installed locally.** Run `npm run test:e2e:install` before E2E checks.

## Not created intentionally

No `ARCHITECTURE.md`, detailed database design, complete API architecture, service diagram, infrastructure plan, auth flow, dashboard, login, onboarding, Business Brain, or fake production dataset was created.

## Scope reconciliation (2026-10-02)

During re-verification, a prior session had added a modular-monolith skeleton that violates the approved scope ("no architecture document yet", "do not make architectural decisions that have not yet been approved", and `AGENTS.md`'s rule against folders implying an unapproved backend design). It was removed on 2026-10-02:

- `modules/` — 19 domain modules (auth, businesses, transactions, expenses, inventory, customers, suppliers, documents, ingestion, extraction, analytics, profit-leaks, cash-flow, simulator, business-brain, rag, actions, notifications, audit) with application services, repository interfaces, and status state machines.
- `lib/registry.ts` — DI container for the modules.
- `lib/boundaries.ts` — module dependency graph / import-boundary rules.
- `lib/events.ts` — in-process event bus (event-driven design, explicitly excluded).
- `lib/database/` — database client abstraction (PostgreSQL/Supabase).
- `lib/types.ts` — shared branded IDs, `Money`, `TenantContext`, pagination, audit metadata.
- `lib/errors.ts` — application error hierarchy.
- `lib/validators.ts` — shared Zod schemas for API-shaped inputs.
- `lib/ai/tools/` — AI tool registry types (coupled to the removed tenant context).

What was kept, because the task explicitly prepares it: `lib/ai/schemas.ts` (Zod schemas for extraction/insight/leak/risk/scenario/action/answer outputs), `lib/ai/model-config.ts` + `lib/ai/router/` (centralized role-based model configuration), `lib/ai/providers/types.ts` (provider abstraction), `lib/ai/guards/` (malformed-output rejection), `lib/ai/telemetry/` (AI operation records), and `lib/utils.ts`.

Domain models, financial calculation rules, and service interfaces from the removed code are not approved requirements; they must be re-derived from `PRODUCT_SPEC.md`, `ROADMAP.md`, and the approved UI flows, not restored from history.

## Multi-agent coordination (2026-10-02)

Several agent sessions were active in this repository at once: this opencode session, a second opencode session (read-only "give me summary" request, completed), and an omnirush agent (gpt-6-astra, terminal s007) that started the original setup at 00:25 and continued writing after this session began reconciling scope. It kept re-creating variants of the removed architecture (`modules/`, `lib/types.ts`, event bus, a new `tests/architecture.test.ts`, and later a root-level `database/` with its own schema).

Coordination is disk-based: `COORDINATION.md` is a shared board every agent in this repository must read before writing (a rule now also lives in `AGENTS.md` → "Inspect before modifying"). It records the intentionally-removed files, the allowed scope, active sessions, and a pending-intent log. If another agent continues writing against the approved scope, the churn will be visible in `git status` after the initial commit.

## Explorer and repository hygiene (2026-10-02)

- Removed build/agent-state clutter: `tsconfig.tsbuildinfo`, `__agent__/` session state, `SESSION_MEMORY.md` (superseded by this audit), and the out-of-scope `tests/architecture.test.ts`.
- `.gitignore` now covers `*.tsbuildinfo` and `__agent__/`.
- Git metadata was missing entirely, so the repository was initialized locally on branch `main` with one initial commit of the verified foundation. No remote exists yet; push and branch protection are owner actions (`GITHUB_SECURITY.md`).

## Skills verification (2026-10-02)

Verified against the official repositories via the `skills` CLI (`npx skills@latest`), which maintains `skills-lock.json`:

- `ai-sdk` from `vercel/ai` — installed. This is the official Vercel AI SDK skill; no skill named "Vercel AI SDK" exists, and `use-ai-sdk` is its directory name.
- `next-dev-loop` from `vercel/next.js` — installed (official Next.js agent guidance).
- `shadcn` from `shadcn-ui/ui` — installed (official shadcn agent skill).
- `vercel-react-best-practices`, `vercel-composition-patterns`, `vercel-optimize`, `web-design-guidelines` from `vercel-labs/agent-skills` — installed and refreshed to latest.
- No official "Vercel Frontend Design" skill exists in `vercel-labs/agent-skills` or `vercel/ai`; `web-design-guidelines` is the official UI-review skill and is not replaced by an unverified third-party lookalike.

## Recommended next step

Approve the product requirements and first UI flows in `PRODUCT_SPEC.md` and `DESIGN_SYSTEM.md` before adding product routes or choosing persistence/auth architecture.
