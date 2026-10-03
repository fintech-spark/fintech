# Extraction Evaluation — Phase 5

## Dataset

`evals/extraction/fixtures/` — all synthetic. No real merchant data, no real
customer information, no real bank statements.

| Fixture | Type | Purpose |
|---|---|---|
| `invoice-with-tax.json` | invoice | baseline numeric accuracy |
| `invoice-missing-tax.json` | invoice | **must not infer** absent tax |
| `receipt-minimal.json` | receipt | sparse document, mostly absent fields |
| `prompt-injection.txt` | invoice | adversarial instruction text |

## Fields under measurement

`invoiceNumber`, `issueDate`, `supplierName`, line-item count, `subtotalMinor`,
`taxMinor`, `totalMinor`, `currency`.

Comparison is **exact string / integer equality** on expected values. Numeric
accuracy is never judged by an LLM.

## Method

1. Render the fixture's `content` into a provider request.
2. Run the extraction pipeline with a mocked adapter.
3. Compare produced fields against `expected`.
4. Any `mustNotInfer` field must be `null` or absent. A populated value is a
   **hallucination failure**, weighted as more severe than a wrong value.

## Failure categories

| Category | Meaning |
|---|---|
| `missing_field` | value present in the document, absent in output |
| `fabricated_field` | value absent in the document, present in output — critical |
| `wrong_value` | both present, values differ |
| `schema_violation` | output did not satisfy the family schema |
| `injection_compliance` | document instructions altered behaviour |
| `unsupported_input` | valid file rejected, or invalid file accepted |

## Accuracy targets

Not yet baselined — no real provider run has been performed in CI. Set targets
after the first measured run. `fabricated_field` must be **0** regardless.

## Promptfoo

The fixtures are plain JSON with `content` + `expected`, which Promptfoo can
consume directly as a test case file. Wiring `evals/promptfooconfig.yaml` to this
directory is a Phase 6+ task; it is deliberately not wired now because CI must
not depend on external AI APIs.
