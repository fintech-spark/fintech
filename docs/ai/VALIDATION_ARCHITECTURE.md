# Validation Lifecycle and Pipeline

Status: Phase 6 IMPLEMENTED (feature/ai)

This document describes the validation pipeline that takes extraction results
(from `prompts/extraction/invoice-extraction.v1.md` / `InvoiceExtractionSchema`)
and determines whether they represent trustworthy business information.

It extends (does not replace) `docs/ai/AI_EVIDENCE_RULES.md`.

## Pipeline stages

```
Raw source document (document module)
    ↓
Extraction result (`ExtractionResult`, `modules/extraction/`)
    ↓
Field-level validation (deterministic first, AI where needed)
    ↓
Cross-field consistency (arithmetic, date coherence)
    ↓
Evidence attachment (source reference per `EvidenceRefSchema`)
    ↓
Cross-document check (duplicate / conflict against business records)
    ↓
Document-level decision (VALIDATED / NEEDS_REVIEW / REJECTED / UNSUPPORTED)
    ↓
Persistence (update `ExtractionResult.status` / `validatedAt`; event if needed)
    ↓
Review / Authoritative record (only after approval; never automatic)
```

No stage writes to authoritative business records directly.

## What is validated (deterministic — code, not model)

For invoice / expense / document extractions using `MoneySchema`:

- Required fields present (`invoiceNumber`, `supplierName`, at least one line item if expected).
- `lineItems[].quantity > 0`; `unitPrice.amountMinor` integer; `currency` 3-letter.
- Line-item `totalMinor` ≈ `quantity × unitPrice.amountMinor` (allowing rounding; documented).
- `subtotalMinor` = sum of line-item totals.
- `taxMinor` is present; `totalMinor` = `subtotalMinor - discountMinor + taxMinor` (per DB invariant `chk_transaction_total`).
- `invoiceNumber` format (non-empty string; UUID-like if that's the business convention).
- `issueDate` / `dueDate` parseable and coherent (`dueDate >= issueDate` if both present).
- Currency consistency across document fields.
- Duplicate `invoiceNumber` check against existing `transactions` / `documents` (when accessible under tenant isolation).

Any arithmetic inconsistency is flagged — the source is preserved; the result is
NOT silently corrected.

## What requires AI validation (where deterministic is insufficient)

- Ambiguous vendor / supplier identification (partial text, OCR error).
- Unclear date format or date inference from partial text.
- Unclear whether a line item is a service vs product.
- Source ambiguity (is the value from the document or inferred?).
- Detection of embedded instructions / prompt injection inside source document.
- Classification of validation reason (why is this unclear?).

Every AI validation uses bounded context (only the extraction result + relevant
source fragment + the specific ambiguous field), not the full database.

## Evidence attachment rules (per AI_EVIDENCE_RULES.md)

- `documentId`: the source document.
- `sourceType`: `invoice`, `receipt`, `expense`, etc.
- `field`: the extracted field name.
- `excerpt`: only if the provider / extraction can provide it; never fabricated.
- `recordId`: business record only if cross-document comparison performed.
- `observedAt`: document timestamp.

If `excerpt` unavailable: do not invent; set `evidence.support = 'PARTIAL'` or
`'UNSUPPORTED'` accordingly.

## Decision logic (not hard-coded to a single score)

| Condition | Status |
|---|---|
| All required fields present + arithmetic consistent + direct source evidence + no contradiction | `VALIDATED` |
| Required field missing / arithmetic inconsistent / contradiction / unsupported critical value | `REJECTED` |
| Ambiguous vendor / partial evidence / unclear date / missing optional required for use | `NEEDS_REVIEW` |
| Source present but ambiguous / conflicting fragments / stale | `NEEDS_REVIEW` (with reason) |
| Provider failure / malformed output / missing evidence for critical value | `FAILED` (safe; do not assume valid) |

No automated promotion from `NEEDS_REVIEW` to `VALIDATED` without human review or
verified correction.

## Security boundaries

- Validation must use `TenantContext` to derive `businessId`; never trust client-provided `business_id` in validation requests.
- Source retrieval must use existing `modules/documents/` infrastructure with `business_id` filter.
- Evidence must not reference Business B records when running for Business A.
- No service-role client in validation path; if admin access needed (e.g., cross-record comparison), it must use `lib/supabase/admin-client.ts` with `bypassRowLevelSecurity: true` and be server-only.
- Prompt injection: document content is untrusted data inside `<user_document>`; validation prompts must not allow document text to become instructions.

## Deterministic checks (must never ask LLM)

- `MoneySchema` arithmetic.
- Date consistency.
- UUID / format checks.
- Duplicate identifier lookup.
- Schema structure (`InvoiceExtractionSchema` / `ExpenseExtractionSchema`).

## AI checks (only where value is ambiguous or requires interpretation)

- Source-text comparison (does the text say what the extraction claims?).
- Classification of validation failure reason.
- Ambiguous vendor / supplier identification.
- Prompt-injection detection inside document.

## Fixtures and evaluation

Files: `evals/validation/fixtures/` (synthetic only: valid, missing-optional,
inconsistent-subtotal, incorrect-line-item, ambiguous-vendor, unreadable-field,
unsupported-derived, conflicting-evidence, duplicate-invoice, prompt-injection).

Every fixture has expected status (`VALIDATED` / `NEEDS_REVIEW` / `REJECTED`).

Metrics tracked in evaluation:
- False acceptance: invalid extraction incorrectly accepted.
- False rejection: valid extraction incorrectly rejected.
- Evidence coverage rate.
- Review rate (must be > 0 to prove system is not over-accepting).

## Persistence

Validation results update `ExtractionResult` status and set `validatedAt`. If
full historical replay is needed, record via existing `EventBus` or audit
mechanism (`audit_logs` with `business_id`, `actor_id` = validation user,
`action` = `'validation_completed'`, `entity_type` = `'extraction_result'`).

No direct writes to `transactions`, `expenses`, `inventory_movements`, etc.
from validation.
