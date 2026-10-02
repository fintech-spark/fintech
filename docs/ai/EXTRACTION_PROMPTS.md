# Extraction Prompts — Phase 5

## Versions

| Version | File | Schema | Runtime constant |
|---|---|---|---|
| v1 | `prompts/extraction/invoice-extraction.v1.md` | `InvoiceExtractionSchema` | `EXTRACTION_PROMPT_VERSION` |

Runtime system prompts live in
`modules/extraction/application/prompt-builder.ts`. The markdown is the reviewable
specification. `buildExtractionSystemPrompt(sourceType)` is the single source.

## Schema mapping

| Document source | Family schema |
|---|---|
| `invoice`, `pdf`, `image`, `upi_screenshot` | `InvoiceExtractionSchema` |
| `receipt` | `ExpenseExtractionSchema` |
| `text`, `whatsapp_export` | `OrderExtractionSchema` |
| everything else | refused |

## Security principles

1. **The system prompt is a constant.** No document content is concatenated into it.
2. **Untrusted content is delimited.** `<merchant_document>` … `</merchant_document>`,
   declared untrusted in the system prompt.
3. **Markers are neutralised.** A document containing a marker has it HTML-escaped,
   so it cannot close the wrapper and escape into instruction space.
4. **No tools.** `tools` is unset on the request. A successful injection has nothing to call.
5. **No database access.** The model receives bytes and returns JSON. Nothing else.
6. **No arithmetic.** Totals and tax are copied verbatim, never computed.

## Change control

Prompt changes require a new version suffix, a bump to `EXTRACTION_PROMPT_VERSION`,
and a passing test run. Every stored extraction records the prompt version in
`modelUsed`, so a result is always attributable.
