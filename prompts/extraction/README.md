# Extraction Prompt Registry

Runtime system prompts live in
`modules/extraction/application/prompt-builder.ts` so that a prompt cannot be
edited without a code review and a test run. The markdown files in this
directory are the **reviewable specification** of each prompt.

| File | Version | Schema | Status |
|---|---|---|---|
| `invoice-extraction.v1.md` | v1 | `InvoiceExtractionSchema` | active |

## Prompt-security principles

1. **The system prompt is a fixed constant.** No document content is ever
   concatenated into it.
2. **Document content is wrapped** in `<merchant_document>` … `</merchant_document>`
   and that wrapper is declared untrusted in the system prompt.
3. **The wrapper is escaped.** A document containing the closing marker has it
   neutralised to `&lt;/merchant_document&gt;`, so it cannot escape early.
4. **No tools.** `CompletionRequest.tools` is deliberately unset for
   extraction. A successful injection has nothing to call.
5. **No database access.** The model never receives credentials and never
   executes SQL.

## Change control

Editing prompt behaviour requires: a new version suffix in the filename, a bump
to `EXTRACTION_PROMPT_VERSION`, and a passing test run. Prompts are never
silently replaced, because an extraction record stores the prompt version that
produced it.
