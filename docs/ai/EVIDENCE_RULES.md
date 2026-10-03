# AI EVIDENCE RULES — Validation Addendum (Phase 6)

This is an extension to `docs/ai/AI_EVIDENCE_RULES.md`, not a replacement.
The core claim-envelope rules (source IDs, evidence quality, review states,
conflicts, provenance) remain unchanged. This addendum defines how validation
uses those rules.

## Evidence categories for validation

| Category | Meaning | When used |
|---|---|---|
| `DIRECTLY_SUPPORTED` | Source text/field clearly shows the extracted value | High-confidence extraction of readable fields |
| `DERIVED` | Value computed from source (e.g., subtotal from line items; total from subtotal+tax) | Deterministic arithmetic; must reference inputs |
| `INFERRED` | Model interpretation required (e.g., vendor named only by partial match; ambiguous date format) | Ambiguous source; requires review |
| `UNSUPPORTED` | Source does not contain the value; model may have invented or extrapolated | Rejected / needs-review |
| `CONFLICTING` | Multiple source fragments contradict | Needs review; do not silently pick one |
| `STALE` | Source timestamp older than expected; extraction may be outdated | Warning; not automatic rejection |
| `PARTIAL` | Some fields present; missing fields remain missing | Needs review if required fields absent |

## Validation evidence requirements

For each important extracted field (per `InvoiceExtractionSchema` / `ExpenseExtractionSchema`):

- If `needsReview = true`: evidence must state what is missing/ambiguous.
- If `needsReview = false`: at least one `DIRECTLY_SUPPORTED` or `DERIVED` reference must exist for required fields.
- If arithmetic is validated deterministically: `DERIVED` evidence references the line items / subtotal / tax that produce the result.
- If a contradiction is found: `CONFLICTING` evidence references the contradictory fragments; result is `REJECTED` or `NEEDS_REVIEW`, never silently corrected.

## Evidence must never be fabricated

- No invented page numbers, coordinates, or citations.
- If the provider does not return a source excerpt, record `excerpt` as `undefined`.
- Do not quote a fragment that is not present in the source.
- Do not fabricate `recordId` references to non-existent business records.

## Source traceability

Every validation result for a document should carry:

- `documentId` (from `DocumentId` in `lib/types.ts`)
- `businessId` (tenant isolation preserved)
- `extractionId` (original result ID)
- `validatorType`: `'deterministic' | 'ai' | 'mixed'`
- `validatedAt`: timestamp of validation
- `status`: `'VALIDATED' | 'NEEDS_REVIEW' | 'REJECTED' | 'UNSUPPORTED'`
- `evidence`: array of `EvidenceRefSchema`-compatible objects

## Cross-document consistency

When comparing with trusted business records (e.g., existing supplier, transaction):

- Use the business's own records only (`business_id = auth.uid()'s memberships`).
- If a duplicate `invoiceNumber` exists: `CONFLICTING`; do not delete either.
- If an existing transaction references the same supplier: `DERIVED` or `DIRECTLY_SUPPORTED` depending on source.
- Never expose Business B records to Business A validation.

## Confidence and evidence

- `high` confidence requires direct source support + structural validity + arithmetic consistency.
- `medium` confidence requires at least `DERIVED` or partial `DIRECTLY_SUPPORTED`, with no contradiction.
- `low` confidence = ambiguous / partial / conflicting; must become `needsReview`.
- A model's `confidence` score alone does not determine status (per AI_RULES.md).
