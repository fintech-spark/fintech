# Merchant Brain — Agent Instructions & Antigravity Engineering System

## Purpose and Scope

Merchant Brain helps small merchants understand business state from messy business data. The repository is structured as a **Modular Monolith (Microlith)**: ONE repository, ONE deployable Next.js unit, ONE primary PostgreSQL database, and 19 logically isolated domain modules.

## Read first

**`AI_CONTEXT.md` is the single authoritative statement of what Merchant Brain is and how it
must be built.** Read it before your first action in this repository. It is the
tie-breaker: if any other document contradicts it, `AI_CONTEXT.md` wins and the other
document should be reported, not followed. It also carries the hard rules against invented
APIs, invented data, and unverified claims.

Then read this file, and the smallest relevant source files before editing. `docs/ai/AI_RULES.md` governs AI reliability; `docs/product/DESIGN_SYSTEM.md` governs UI; `SECURITY.md` governs security; `docs/engineering/TESTING.md` governs checks. Treat source code and `package.json` as ground truth over any document, including `AI_CONTEXT.md`.

### Step 0 — mandatory skill and tool triage

Before your first action on **any** task, including small ones:

1. Read [`SKILLS.md`](./SKILLS.md) — the generated index of all 29 skills.
2. Match your task against the table in [`.agents/workflows/skill-first.md`](./.agents/workflows/skill-first.md).
3. **Load every matching skill** before planning or editing.
4. Check which MCP tools you actually have (`context7` for current docs, `next-devtools` for Next.js runtime state) and use them instead of guessing.

`token-efficient-agent` and `multi-agent-concurrency` apply to every task. The user should never have to ask for skills to be used.

---

## Antigravity Engineering System Architecture

This repository is powered by an Antigravity-native engineering system under `.agents/`:

```text
AGENTS.md
.agents/
├── agents/    # Specialized sub-agent personas (security, AI, architecture, testing)
├── rules/     # Persistent project rules loaded into agent context
└── skills/    # Reusable workflow knowledge bases and procedures
```

### Specialized Agents (`.agents/agents/`)

Use these agents proactively for specialized engineering tasks:

| Agent | Capability & Focus | Trigger Condition |
| :--- | :--- | :--- |
| **`security-reviewer`** | OWASP Top 10, secrets detection, auth/authorization, PII protection | PROACTIVELY after writing code with auth, endpoints, inputs, or DB queries |
| **`threat-modeler`** | STRIDE threat modeling, attack surface mapping, trust boundaries | When designing new modules, APIs, or changing tenant isolation |
| **`prompt-defense-specialist`** | Prompt injection defense, delimiter isolation, jailbreak detection | When authoring prompts, ingesting documents, or defining AI tools |
| **`api-security-reviewer`** | Route handler security, webhook signatures, rate limiting, CORS | When implementing or modifying endpoints in `app/api/` |
| **`ai-engineer`** | Vercel AI SDK integration, structured output, model routing, evals | When building LLM features, prompt templates, or evaluation suites |
| **`rag-pipeline-reviewer`** | Chunking, embedding leakage, retrieval precision, grounding checks | When creating or modifying vector search and RAG pipelines |
| **`architect`** | Modular Monolith system design, domain module isolation, scalability | When adding modules, altering boundaries, or designing large features |
| **`code-reviewer`** | Code quality, maintainability, clean code standards (<50 line functions) | PROACTIVELY after any code changes before committing |
| **`database-reviewer`** | PostgreSQL specialist, query optimization, multi-tenant isolation, RLS | When writing schemas, migrations, or database queries |
| **`tdd-guide`** | Test-Driven Development (Red-Green-Refactor), unit & invariant tests | When implementing new business rules or fixing defects |
| **`e2e-runner`** | Playwright test automation, critical flow verification | Before merging changes touching user-facing journeys |
| **`performance-optimizer`** | Latency profiling, memory leaks, Next.js bundle size reduction | When code introduces heavy queries, large bundles, or slow loops |
| **`build-error-resolver`** | TypeScript compiler errors, Next.js Turbopack build diagnostics | When `npm run typecheck` or `npm run build` fails |
| **`silent-failure-hunter`** | Detection of swallowed exceptions, missing Result monad propagation | During security audits and code reviews |
| **`type-design-analyzer`** | Branded IDs, Result monad invariants, strict type design | When introducing domain entities or data contracts |
| **`planner`** | Step-by-step implementation planning and verification loops | Before starting complex, multi-module features |

### Persistent Project Rules (`.agents/rules/`)

These rules are persistent policies that govern all development:

1. **`security.md`**: Zero hardcoded secrets, input validation with strict Zod, tenant isolation (`business_id`), parameterized SQL, PII masking, webhook verification.
2. **`ai-engineering.md`**: Deterministic arithmetic over model guesses, strict Zod structured output, prompt versioning in `prompts/`, synthetic evals in `evals/`.
3. **`backend-architecture.md`**: Modular Monolith invariants, domain module isolation (`modules/<domain>/`), public barrels (`index.ts`), acyclic boundaries (`lib/boundaries.ts`), in-process `EventBus`.
4. **`api-security.md`**: Session verification, rate limiting, security headers, CORS, request body parsing, egress timeouts.
5. **`code-review.md`**: Mandatory review triggers, severity levels (CRITICAL, HIGH, MEDIUM, LOW), 800-line file ceiling.
6. **`coding-style.md`**: Strict TypeScript, zero `any`, branded IDs, `Result<T, E>` functional monad, integer minor-unit `Money`.
7. **`testing.md`**: TDD workflow, synthetic fixtures only, verification loop (`npm run lint && npm run typecheck && npm test && npm run build`).

### Available Skills (`.agents/skills/`)

Skills provide deep procedural context on demand:
- **Security & Integrity**: `security-review`, `security-scan`, `threat-modeling`, `api-security`, `safety-guard`, `gateguard`
- **AI & Evaluation**: `ai-sdk`, `eval-harness`, `iterative-retrieval`, `prompt-optimizer`
- **Architecture & Backend**: `backend-patterns`, `architecture-decision-records`, `verification-loop`
- **Frontend & UI**: `shadcn`, `web-design-guidelines`, `vercel-composition-patterns`, `vercel-react-best-practices`, `next-dev-loop`, `vercel-optimize`, `e2e-testing`, `api-design`

---

## Security Engineer + AI Engineer Workflow Protocols

For engineers operating in the dual role of Security Engineer and AI Engineer on Merchant Brain:

### 1. Security Review & Threat Modeling Protocol
- **Every boundary crossed is untrusted**: HTTP request -> Route Handler -> Domain Service -> Database.
- **Tenant Context Verification**: Always derive `businessId` from the authenticated session context. Never trust client-supplied tenant identifiers in request payloads.
- **SQL Parameterization**: Every SQL query executed through `DatabaseClient` must use parameterized placeholders (`$1, $2`). Concatenated SQL queries are strictly blocked.
- **Secrets Management**: Verify that `.env` files are ignored and that no API keys or private certificates appear in git history. Run `security-scan` prior to commits.

### 2. Prompt Injection & LLM Security Protocol
- **Untrusted Input Wrapping**: Never concatenate raw user or document text directly into system instructions. Wrap untrusted text in structural XML tags:
  ```text
  <user_document>
  ${untrustedDocumentText}
  </user_document>
  ```
- **Arithmetic Protection**: Never ask the model to calculate sums, tax rates, profit margins, or ledger balances. Calculate deterministically in TypeScript and supply verified results to the prompt.
- **Zod Validation Guard**: Every model response must be parsed with a Zod schema. If parsing fails, fall back to a safe error state; never attempt heuristic repairs on malicious payloads.
- **Tool Permission Boundaries**: AI tools registered in `lib/ai/tools/` must require verified `TenantContext` and must not expose arbitrary command execution or unrestricted database queries.

### 3. Verification Loop Protocol
Before declaring any task complete, run the unified verification check:
```bash
npm run verify:setup
```
This executes `npm run lint`, `npm run typecheck`, `npm test` (all unit and architecture tests), and `npm run build` (Turbopack production build).

---

## Code and Naming Conventions

- TypeScript is strict. Prefer explicit domain types and narrow unions.
- Use `PascalCase` for React components/types, `camelCase` for variables/functions, and `kebab-case` for route segments and document filenames.
- Keep server-only code, secrets, and provider clients out of client components. Do not use `NEXT_PUBLIC_` for secrets.
- Keep pure calculations and validation deterministic and independently testable.
- Prefer small modules with one responsibility. Avoid speculative abstractions and barrel files that create bundle-wide imports.
- Use the existing `@/*` alias and existing utilities before adding an alias or utility.
- Do not suppress TypeScript or lint errors without documenting the reason and adding a regression check.

## Folder Principles

- `app/`: Next.js routes and route-level UI only.
- `components/`: reusable UI; `components/ui/` contains shadcn source components.
- `lib/`: pure utilities, schemas, provider boundaries, and server-safe helpers.
- `modules/`: isolated business domain modules with clean `domain/`, `application/`, `infrastructure/` layers.
- `prompts/`: version-controlled prompts, never buried in UI files.
- `evals/`: synthetic evaluation cases and Promptfoo preparation.
- `tests/`: unit, integration, E2E, and synthetic fixtures.
- `.agents/`: Antigravity engineering system (agents, rules, skills).
- `.github/`: CI, security, and dependency automation.

## Definition of Done

A change is done only when its implementation, types, lint, tests, security review, UI/accessibility review, loading/error/empty states, documentation, and AI evaluations (when applicable) are complete. See `docs/agents/DEFINITION_OF_DONE.md` for the full checklist.
