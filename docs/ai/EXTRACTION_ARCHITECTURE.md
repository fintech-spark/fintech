# Extraction Architecture — Phase 5

## Pipeline

```
bytes
  → sniff magic bytes            deterministic, no AI, no cost
  → validate format + size        deterministic
  → authorise tenant              businessId from TenantContext, never from input
  → load document (tenant-scoped)
  → mark processing
  → build prompt                  untrusted content wrapped in delimiters
  → provider.complete             multimodal, no tools, bounded timeout
  → guardJSON                     parse
  → guardOutput                   Zod validate against the family schema
  → classify confidence           deterministic, Phase 1 thresholds
  → persist CANDIDATE data        document_extractions only
  → mark extracted
```

No step may be skipped or reordered. Authorisation precedes retrieval; validation
precedes any provider call.

## Three distinct things

| Concept | Type | Mutability |
|---|---|---|
| **Raw document** | `Document` + stored bytes | immutable after upload |
| **Extraction result** | `ExtractionResult` | candidate; mutable until Phase 6 validates |
| **Business record** | `Transaction`, `Expense`, `Product`, … | authoritative; **never written by Phase 5** |

Extraction does not create transactions, expenses, customers, suppliers or
inventory rows. That is Phase 6 work behind an explicit, deterministic conversion.

## Supported inputs

Derived from the existing `DocumentSourceType` union and the 50MiB storage limit.

| Kind | MIME | Extensions | Multimodal | Max |
|---|---|---|---|---|
| PDF | `application/pdf` | `.pdf` | yes | 50 MiB |
| Image | `image/png`, `image/jpeg`, `image/webp` | `.png` `.jpg` `.jpeg` `.webp` | yes | 20 MiB |
| CSV | `text/csv`, `text/plain` | `.csv` | no | 10 MiB |
| Text | `text/plain` | `.txt` `.text` | no | 5 MiB |

Anything else — executables, archives, office formats, audio — is rejected. Audio
appears in `DocumentSourceType` but is **not** extractable in Phase 5.

## Detection is by content, not by name

`sniffFileSignature` reads leading bytes: `%PDF-`, the PNG magic, JPEG SOI, RIFF/WEBP.
Text formats must additionally decode as strict UTF-8 and contain no control bytes.

* A `.pdf` name on an ELF binary is rejected.
* A `.png` name on a real PDF is rejected (extension does not match content).
* A declared `Content-Type` that contradicts the sniffed type is rejected.
* Plain text whose first line contains a delimiter is classified `csv`, so a
  `.txt` name is refused. Content outranks the filename by design.

## Schemas

Reused from `lib/ai/schemas.ts`, one per family:

| Source type | Schema |
|---|---|
| `invoice`, `pdf`, `image`, `upi_screenshot` | `InvoiceExtractionSchema` |
| `receipt` | `ExpenseExtractionSchema` |
| `text`, `whatsapp_export` | `OrderExtractionSchema` |

Other source types are refused rather than coerced into a wrong schema.

**Non-hallucination is structural, not aspirational.** Every optional value in
those schemas is `.nullable()`. A missing field is `null` by construction; there
is no representation for "the model filled this in".

## Confidence

`ConfidenceLevel` is categorical — `high` | `medium` | `low` — using Phase 1's
`CONFIDENCE_THRESHOLDS`. No fabricated float precision.

| Case | Level |
|---|---|
| field absent (`value === null`) | `low` |
| field extracted by the model | `medium` |
| overall | the **lowest** field level |

Overall confidence is a minimum, never an average. An average would let a
confidently-read supplier name mask a guessed total. Absence is never `high`.

## Provenance

Only what the schema actually carries: `EvidenceRefSchema` (`sourceId`,
`recordId`, `sourceType`, optional `field`/`excerpt`/`observedAt`). Phase 5 stores
no page numbers, coordinates or text offsets, because none are produced. Each
record's `modelUsed` embeds the prompt version (`provider:model#prompt-version`)
so a result can be traced to the prompt that produced it.

## Failure handling

| Category | Retried | Terminal state |
|---|---|---|
| `timeout` | yes | `failed` |
| `rate_limited` | yes | `failed` |
| `provider_unavailable` | yes | `failed` |
| `schema_mismatch` | **no** | `failed` |
| `auth_failed` | **no** | `failed` |
| `unsupported_input` | **no** | `failed`, before any provider call |

Retries are bounded by `maxAttempts` (default 3). Schema failures are never
retried: they cannot succeed, and each attempt costs money.

## Idempotency

`findByDocument` is consulted before any provider call. A completed extraction is
returned rather than recomputed, so a retried request cannot produce a second
record. Only a `failed` record is re-attempted.

## Security

| Control | Where |
|---|---|
| Tenant scoping | `businessId` from `TenantContext`; loaders must filter by it |
| Authorisation before retrieval | `extract()` resolves the document before loading bytes |
| File validation | magic bytes, extension consistency, size |
| Filename hardening | `sanitiseFileName` strips path separators and control characters |
| Prompt injection | delimiter wrapping + marker neutralisation |
| No tool surface | `CompletionRequest.tools` deliberately unset |
| No DB access by the model | the adapter is a completion interface only |
| Bounded time | `timeoutMs` via `Promise.race` |
| Bounded spend | `maxAttempts`, plus idempotency |

**Open risk:** `feature/ai` does not contain Phase 2, so database-level tenant
isolation is absent on this branch. The extraction code is tenant-scoped by
contract; the database does not yet enforce it here.

## Future boundary

Phase 6 owns business-truth validation, evidence scoring and human review.
`ExtractionService.validate()` intentionally throws in Phase 5.
