# Extraction Audit — Phase 5

**Branch:** `feature/ai` · **Date:** 2026-10-03
**Agent 1, read-only.** No product implementation was modified during this audit.

## Summary

The extraction *contracts* were complete before Phase 5. The *pipeline* was not.
Phase 5 implemented the pipeline against existing contracts and invented no new
document types, statuses, or field semantics.

| Component | Current behaviour | Status | Depends on | Risk | Required change |
|---|---|---|---|---|---|
| `modules/extraction/domain/types.ts` | `ExtractionResult`, `ExtractionField`, `ConfidenceLevel`, `classifyConfidence()` | **Implemented** (Phase 1) | `lib/types` | none | none |
| `modules/extraction/application/service.ts` | `ExtractionService` interface, 4 methods | **Partial** — interface only | `TenantContext` | none | implemented in Phase 5 |
| `lib/ai/schemas.ts` | `InvoiceExtractionSchema`, `ExpenseExtractionSchema`, `OrderExtractionSchema`, `MoneySchema`, `EvidenceRefSchema` | **Implemented** (Phase 1) | zod | none | reused unchanged |
| `lib/ai/guards/` | `guardJSON`, `guardOutput` | **Implemented** (Phase 1) | zod | none | reused unchanged |
| `lib/ai/providers/types.ts` | `AIProviderAdapter`, `CompletionRequest`, `AIContentPart` (text + image) | **Interface only** | — | medium | adapter supplied by host app; contract already sufficient |
| `lib/ai/router/` | `createModelRegistry` | **Partial** | env | low | extraction resolves its `ModelConfig` via config, not by hardcoding |
| Document lifecycle | `DocumentStatus` + `DOCUMENT_STATUS_TRANSITIONS` | **Implemented** (Phase 1) | — | none | reused; no new statuses |
| MIME / file validation | none | **Missing** | — | **high** | magic-byte sniffing implemented in Phase 5 |
| Extraction pipeline | none | **Missing** | `AIProviderAdapter` | **high** | implemented in Phase 5 |
| Prompt-injection defence | none | **Missing** | — | **critical** | delimiter wrapping + tool-free request implemented in Phase 5 |
| Persistence | `document_extractions` table exists | **Partial** — table only | — | medium | `ExtractionRepository` port defined; adapter supplied by host app |
| Prompt versioning | `prompts/extraction/invoice-extraction.v1.md` | **Partial** | — | low | runtime prompt + registry documented in Phase 5 |
| Retry / timeout | none | **Missing** | — | high | bounded retry + timeout implemented in Phase 5 |
| Tests | none for extraction | **Missing** | — | high | 39 tests added in Phase 5 |
| Evaluation fixtures | Phase 6 fixtures exist for validation | **Partial** | — | medium | 4 extraction fixtures added in Phase 5 |

## Reused, not duplicated

* `classifyConfidence()` and `CONFIDENCE_THRESHOLDS` — confidence thresholds are Phase 1's.
* `guardJSON` / `guardOutput` — the only path from model output to typed data.
* `DocumentStatus` and its transition table — no new status invented.
* `MoneySchema.amountMinor` — money stayed integer minor units.
* `ExtractionField` / `ExtractionResult` — the Phase 1 domain shape is the persisted shape.
* `AIContentPart.image` — multimodal input needed no new abstraction.

## Required outside this phase

1. **`AIProviderAdapter` implementation.** The interface exists; no concrete
   Google/OpenAI/Anthropic adapter is in the repository. Extraction is written
   against the interface, so the host app supplies it.
2. **`ExtractionRepository` implementation.** Same — port only.
3. **`DocumentSource` / `DocumentContentLoader` implementations.** Must be
   tenant-scoped; see the security report.

## Findings

**F1 — `feature/ai` has no tenant isolation (CRITICAL, pre-existing).**
The branch descends from `f268ded` and does not contain Phase 2 (`9e5aa0c`).
There is no RLS, no `lib/supabase/` client, and no `TenantContext` resolution.
Extraction *code* is tenant-scoped by contract, but nothing at the database layer
enforces it on this branch. See `docs/ai/EXTRACTION_ARCHITECTURE.md` §Security.

**F2 — no file validation existed (HIGH).** Any bytes could reach a provider. Now
sniffed by magic bytes before any AI call.

**F3 — no prompt-injection boundary existed (CRITICAL).** Now implemented;
document content is wrapped and the model is granted no tools.
