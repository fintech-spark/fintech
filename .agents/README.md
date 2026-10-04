# `.agents/` — Agent Skills and agent coordination

Everything an agent needs to work in this repository, in one place.

## Layout

```
.agents/
├── skills/        # Agent Skills (the agentskills.io standard)
├── rules/         # persistent project policies (security, testing, architecture, …)
├── agents/        # specialist sub-agent personas
├── workflows/     # how skills get selected before a task starts
├── tools/         # executable helpers: claim.sh, skills-index.sh, validate-skills.mjs
├── claims/        # runtime lease state — gitignored, never committed
└── README.md      # this file
```

## The two tiers, and why the split matters

**Tier 1 — discovery.** `SKILLS.md` at the repo root is a generated one-line-per-skill index. It is
a few hundred tokens; loading every skill body would be tens of thousands. Read the index, decide,
then load only the skill you need.

**Tier 2 — instructions.** A skill's `SKILL.md` body loads when it activates.

**Tier 3 — resources.** `references/`, `scripts/`, `examples/`, `assets/` load only when the skill
tells you to read them. That is why `SKILL.md` files stay short and push detail into
`references/`.

## Project-specific skills (start here)

These encode *this* codebase — its paths, commands, traps, and known gaps. They are the ones a
merchant-brain task usually needs.

| Skill | Activates when |
|---|---|
| `tenant-isolation-review` | any route, repository query, RLS policy, migration, or AI tool; "can tenant A see B's data?" |
| `database-migrations` | schema change, new table/column/index, RLS, SECURITY DEFINER function, drift fix |
| `api-endpoint-authoring` | creating or changing `app/api/**/route.ts`, status codes, pagination, response shape |
| `auth-session-flow` | login/signup/logout/refresh, session cookies, 401 vs 403, "sign-in doesn't work" |
| `ai-provider-tools` | `lib/ai/**`, extraction, AI tools, evidence, grounding, model routing |
| `financial-rules-and-money` | any computation of revenue, profit, margin, balance, totals, rounding |
| `module-architecture` | new module, service wiring, cross-module imports, event bus, DI |
| `rag-context-pipeline` | chunking, embeddings, retrieval, context budget, pgvector |
| `project-verification` | running or interpreting tests/lint/build/e2e/db tests before claiming done |
| `docs-truthfulness` | writing or correcting any doc or report; a doc contradicts the code |
| `repo-concurrency-protocol` | before writing in a shared tree; unexpected changes; branching or committing |

Vendor/general skills (`supabase`, `shadcn`, `vercel-react-best-practices`, `ai-sdk`,
`security-review`, …) remain available alongside them.

## How an agent should work here

1. Read `AI_CONTEXT.md` first — it is authoritative over every other document.
2. Read `SKILLS.md`, then load the matching skill(s) per `.agents/workflows/skill-first.md`.
   `repo-concurrency-protocol` and `token-efficient-agent` apply to **every** task.
3. **Claim the paths you are about to write**, then work:
   ```bash
   .agents/tools/claim.sh acquire "modules/rag" --note "adds tenant filter" --ttl 1800
   .agents/tools/claim.sh heartbeat     # during long work
   .agents/tools/claim.sh release       # always, even on failure
   ```
4. Stay on the branch you started on. Branches are not a coordination mechanism.
5. Validate with the commands the skill names — usually `npm run lint && npm run typecheck && npm test && npm run build`,
   plus the live-database suite for anything touching data.

## Adding a skill

```bash
mkdir -p .agents/skills/<name>
$EDITOR .agents/skills/<name>/SKILL.md      # frontmatter: name + description
./.agents/tools/skills-index.sh              # regenerate SKILLS.md
npm run skills:validate                     # spec compliance + broken refs + secret scan
```

Requirements the validator enforces:

- directory name == frontmatter `name`; lowercase alphanumerics and single hyphens; ≤ 64 chars
- `description` present, ≤ 1024 chars, and written **activation-first** ("Use when …")
- referenced `references/`/`scripts/`/`examples/`/`assets/` files exist
- referenced repo paths and `npm run` scripts exist
- no secret-shaped strings anywhere in the skill directory
- `SKILL.md` under 500 lines — push detail into `references/`

Write skills from real experience in this repo, not from generic advice. A skill earns its place by
telling the agent something it would otherwise get wrong: the two-database-path trap, the
`hasPermission` gap, why `Output.json()` is not structured output, which 29 tests silently skip.

## Commands

| Command | Purpose |
|---|---|
| `npm run skills:validate` | validate every skill against the agentskills.io spec |
| `npm run skills:index` | regenerate `SKILLS.md` from `.agents/skills/` |
| `./.agents/tools/claim.sh status` | who holds which paths |
| `node .agents/skills/tenant-isolation-review/scripts/scan-tenant-safety.mjs` | flag raw queries lacking a tenant predicate |

Specification: <https://agentskills.io/specification>
