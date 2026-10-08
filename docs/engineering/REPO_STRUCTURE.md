# Repository Structure

> **Canonical reference** for Merchant Brain's file layout. Updated after the
> `refactor/repository-cleanup` consolidation (2026-10-02).

## Branch Model

We use a **single trunk** workflow:

| Branch | Purpose |
| --- | --- |
| `main` | Sole long-lived branch. All work merges here. |
| `feature/<name>` | Short-lived feature branches, opened as PRs against `main`. |
| `fix/<name>` | Short-lived bugfix branches. |
| `refactor/<name>` | Short-lived refactor branches. |

**Archive tags** (prefix `archive/`) preserve the tip of historical branches for
recovery without cluttering the active branch list.

## Directory Map

```text
/
├── .agents/                   # Antigravity engineering system
│   ├── agents/                # Specialised sub-agent personas
│   ├── claims/                # Runtime claim leases (gitignored)
│   ├── rules/                 # Persistent project rules
│   ├── skills/                # Reusable workflow knowledge bases
│   └── tools/                 # claim.sh, skills-index.sh
│
├── .github/
│   ├── workflows/             # CI/CD: ci, security, codeql, e2e, ai-evals, auto-merge
│   ├── dependabot.yml
│   └── copilot-instructions.md
│
├── app/                       # Next.js App Router routes (NO business logic)
│   ├── (auth)/                # Auth group: sign-in, sign-up, onboarding
│   ├── (dashboard)/           # Dashboard group: main merchant UI
│   ├── (marketing)/           # Marketing group: landing page
│   ├── api/                   # Route handlers
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
│
├── components/                # Reusable React components
│   ├── ui/                    # shadcn/ui primitives
│   ├── ai/                    # AI chat and assistant UI
│   ├── actions/               # Human-approval action components
│   ├── cash-flow/             # Cash flow visualisations
│   ├── charts/                # Generic chart wrappers
│   ├── customers/             # Customer management UI
│   ├── dashboard/             # Dashboard layout and widgets
│   ├── forms/                 # Form primitives
│   ├── ingestion/             # Document ingestion UI
│   ├── insights/              # AI insight cards
│   ├── inventory/             # Inventory management UI
│   ├── layout/                # App shell, sidebar, nav
│   ├── simulator/             # Business simulator UI
│   ├── suppliers/             # Supplier management UI
│   └── transactions/          # Transaction list UI
│
├── database/                  # Public barrel — re-exports schema, rows, validation
│   ├── index.ts               # Re-exports lib/database types + schema/rows/validation
│   ├── rows.ts                # Physical PostgreSQL row interfaces
│   ├── schema.ts              # Table name constants and column metadata
│   └── validation.ts          # Zod schemas for row validation
│
├── docs/                      # All project documentation
│   ├── README.md              # Docs index
│   ├── agents/                # Multi-agent coordination docs
│   ├── ai/                    # AI engineering rules and strategy
│   ├── engineering/           # Engineering practices (this file lives here)
│   ├── product/               # Product spec, design system, roadmap
│   └── security/              # Security policies and audit docs
│
├── evals/                     # AI evaluation suites (Promptfoo)
│   ├── business-brain/
│   ├── extraction/
│   ├── hallucination/
│   ├── rag/
│   ├── regression/
│   └── security/
│
├── lib/                       # Pure utilities and provider boundaries
│   ├── ai/                    # AI provider clients and guards
│   └── database/              # Primary PostgreSQL client (canonical)
│       ├── client.ts          # DatabaseClient interface
│       ├── postgres-client.ts # PostgresDatabaseClient implementation
│       └── index.ts           # Public barrel
│
├── modules/                   # 19 isolated domain modules (Modular Monolith)
│   ├── analytics/             # Business analytics
│   ├── auth/                  # Authentication and sessions
│   ├── benchmarks/            # Industry benchmarks
│   ├── businesses/            # Tenant/business management
│   ├── cash-flow/             # Cash flow analysis
│   ├── customers/             # Customer CRM
│   ├── documents/             # Document storage
│   ├── expenses/              # Expense tracking
│   ├── extraction/            # AI document extraction
│   ├── ingestion/             # Multi-channel data ingestion
│   ├── inventory/             # Inventory management
│   ├── notifications/         # Notifications
│   ├── profit-leaks/          # Profit leak detection
│   ├── rag/                   # Retrieval-augmented generation
│   ├── simulator/             # Business scenario simulator
│   ├── suppliers/             # Supplier management
│   └── transactions/          # Transaction ledger
│
├── prompts/                   # Version-controlled prompt files
│   ├── actions/               # Human-approval action prompts
│   ├── assistant/             # Conversational assistant prompts
│   ├── business-brain/        # Business intelligence prompts
│   ├── cash-flow/             # Cash flow analysis prompts
│   ├── extraction/            # Document extraction prompts
│   ├── profit-leaks/          # Profit leak detection prompts
│   ├── reviewer/              # Output review prompts
│   └── simulator/             # Business simulator prompts
│
├── scripts/                   # Build and operational scripts
│   ├── migrate.mjs            # Run Supabase migrations
│   ├── scaffold_monolith.mjs  # Scaffold new domain modules
│   └── seed.mjs               # Seed development data
│
├── supabase/                  # Supabase configuration
│   ├── config.toml
│   ├── migrations/            # Ordered SQL migration files
│   ├── seed.sql               # Development seed data
│   └── snippets/              # Reusable SQL snippets
│
└── tests/                     # Test suites
    ├── architecture.test.ts   # Module boundary tests
    ├── database-schema.test.ts
    ├── database-validation.test.ts
    ├── smoke.test.ts
    ├── e2e/                   # Playwright end-to-end tests
    └── fixtures/              # Synthetic test data (never real PII)
```

## Root-Level Files

| File | Purpose |
| --- | --- |
| `README.md` | Project overview and quick-start |
| `AGENTS.md` | Antigravity agent instructions (tie-breaker: AI_CONTEXT.md wins) |
| `AI_CONTEXT.md` | **Single authoritative source** of what Merchant Brain is |
| `CLAUDE.md` | Claude Code agent instructions |
| `GEMINI.md` | Gemini agent instructions |
| `SKILLS.md` | Generated index of all agent skills |
| `CONTRIBUTING.md` | Contributor guide |
| `SECURITY.md` | GitHub security policy |
| `package.json` | Node.js project manifest |
| `tsconfig.json` | TypeScript configuration |
| `next.config.ts` | Next.js configuration |
| `vitest.config.ts` | Vitest configuration |
| `playwright.config.ts` | Playwright configuration |
| `components.json` | shadcn/ui configuration |
| `skills-lock.json` | Agent skill lock file |

## Invariants

1. **No business logic in `app/`** — routes only; all logic lives in `modules/`
2. **No cross-module direct imports** — use public barrels (`modules/X/index.ts`)
3. **`lib/database/`** is the primary DB client; `database/` is a public barrel alias
4. **`prompts/`** must hold all prompt strings — never embedded in TypeScript files
5. **`evals/`** must cover every AI-facing feature with synthetic fixtures
6. **`tests/fixtures/`** must be synthetic only — never real merchant or personal data
