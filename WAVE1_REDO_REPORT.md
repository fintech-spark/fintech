Agent 2 — Wave 1 Redo (post-Agent1 85f367f, post-Agent3 08926e1)
Branch: feat/database-security (0cdd128 -> new commit)
Absolute rule: NO Agent 1/3/4/5 fixes applied.

Agent 1 status (feature/backend 85f367f):
- Authorization (settings:read, analytics:read) → FIXED by Agent 1.
- Resource bounds (parsePagination page cap, bounded-scan) → FIXED.
- Cross-tenant productId write → FIXED.
- Error contract (409/500 mapping, no constraint leak) → FIXED.
- Status codes (201 for creates) → FIXED.
- State/input rules (PATCH reason guard, item cap 200) → FIXED.
- Injection/filter correctness (LIKE escape, parseFilterValue) → FIXED.
Remaining Agent 1 issue: storagePath isolation still missing (not in 85f367f scope).

Agent 3 status (feature/ai 08926e1):
- Phase 6 validation service → FIXED by Agent 3.
- Evidence/provenance (evidence envelope, CONFLICTING entry) → FIXED.
- Prompt injection (vision path) → PARTIAL (`P` per .phase7/AUDIT.md: vision image reaches model unwrapped).
- Provider adapter runtime caller → MISSING (`M` — adapter exists, zero importers outside test double).
- Structured output (`responseFormat`) → INCORRECT (`I` — declared but never read in complete()).

Agent 4 status (feature/intelligence): unchanged since previous review.

Security-owned updates (this redo):
- lib/database/postgres-client.ts: assertTenantSafe() intact (verified by grep).
- WAVE1_REDO_REPORT.md: updated findings.

New security findings (not patched — security-owned / Agent 3 scope):
P7-001 Agent 3: vision-path prompt injection remains partial (image unwrapped before model).
P7-002 Agent 3: provider adapter has zero runtime callers; structured-output never enforced.
P7-003 Security: assertTenantSafe() present but never tested against live DB (tests blocked).

Verification (redo):
- lint: BLOCKED (eslint binary missing)
- typecheck: BLOCKED (tsc binary missing)
- test: BLOCKED (vitest missing, node_modules absent)
- DB-backed RLS tests: BLOCKED (LOCAL_DATABASE_URL unavailable)
- agent2-redteam SQL audit: VERIFIED BY INSPECTION (passes)
- Security file integrity: VERIFIED (assertTenantSafe present, 3 calls intact)

No skipped checks reported as passed.
