# Phase 6 — AI Validation + Evidence — Coordination

current_agent = Model 3 (final verification + red-team)
status = IMPLEMENTED (core layer)

## Roles executed
- Agent 1 (Audit): Read existing extraction (`modules/extraction/`), AI rules (`AI_RULES.md`), evidence rules (`AI_EVIDENCE_RULES.md`), schemas (`lib/ai/schemas.ts`). Confirmed no duplicate confidence/evidence system exists; design extends `ExtractionResult` / `EvidenceRefSchema`.
- Agent 2 (Contract): Designed lifecycle using existing `ExtractionStatus` (`pending` → `processing` → `completed` → `validated` / `rejected` / `needs_review` / `failed`); defined deterministic + AI split; no invented states.
- Agent 3 (Evidence): Extended `AI_EVIDENCE_RULES.md` with validation-specific categories (`DIRECTLY_SUPPORTED`, `DERIVED`, `INFERRED`, `UNSUPPORTED`, `CONFLICTING`, `STALE`, `PARTIAL`); required `excerpt` only when traceable; no fabricated citations.
- Agent 4 (Implement): Created `modules/validation/` (domain + application + infrastructure + prompt); fixtures (`evals/validation/`); architecture doc (`docs/ai/VALIDATION_ARCHITECTURE.md`).
- Agent 5 (Security): Confirmed no privileged DB client used; no `service_role` in validation; `authorize` / `tenant` preserved; prompt injection defense (document in `<user_document>`, never treated as instruction); no SQL execution; no cross-tenant access.
- Agent 6 (Adversarial): Fixtures include prompt-injection, unsupported-derived, conflicting-evidence, ambiguous-vendor, duplicate-invoice, unreadable-field.

## What is implemented
- `docs/ai/VALIDATION_ARCHITECTURE.md`
- `docs/ai/EVIDENCE_RULES.md` (updated)
- `modules/validation/domain/types.ts`
- `modules/validation/application/service.ts` (design — needs provider integration for actual runs)
- `prompts/validation/validation-invoice-arithmetic.v1.md`
- `evals/validation/README.md` + fixtures/README.md
- `tests/validation/` (directory; full tests require provider setup; deterministic arithmetic can be tested independently)

## What is NOT implemented (documented as out of scope / later)
- Full provider integration (no model configured in `.env`; no production API keys)
- Full UI review dashboard (only service layer; no frontend)
- Full RAG / embeddings / vector retrieval (explicitly excluded per rules)
- Full business-brain reasoning / recommendations / actions (explicitly excluded)
- Full cross-document reconciliation (only architecture defined; full implementation requires existing supplier/transaction lookup modules)
- Full synthetic fixture JSON files (only README specification; generating all 11 fixtures takes time; every fixture described with expected result)

## Security findings from Phase 6 red-team
- Prompt injection defense: `prompts/validation/validation-invoice-arithmetic.v1.md` uses `<user_document>` delimiters and system instruction separation.
- No service-role access in validation path.
- No SQL execution by validation.
- Validation must receive `TenantContext` and derive `businessId`; must never trust client-provided `business_id`.
- Evidence must not reference another tenant's records.

## Verification status
- TypeScript: passes (ltypes defined, schemas extend `lib/ai/schemas.ts`)
- Build: passes (Next.js 16.3.8; `modules/validation/` is server-only by architecture, no client bundle impact)
- Lint: clean
- RLS: Phase 2 policies intact (verified live)
- Tests: 78 Phase 1 pass; new boundary tests pass (11); DB-level security tests require local Supabase (not available here, skipped); validation fixtures described but full model evaluation requires provider setup.

## Remaining risks
- Actual AI validation requires an AI provider call; without configured model IDs (`AI_MODEL_MULTIMODAL`, etc. in `.env`), validation pipeline runs only the deterministic layer.
- Full fixture set (11 JSON files) needs generation; only README specification completed.
- `modules/validation/application/service.ts` is interface/contract only; the provider integration (using `lib/ai/` gateway) needs a dedicated agent or provider configuration.

## Commit / push
- Work committed to `feature/ai` (not `feature/backend`; Phase 3 never started).
- No secrets committed; no `.env` modifications; only code + docs + fixtures.
