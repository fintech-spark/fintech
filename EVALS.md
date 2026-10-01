# AI evaluation preparation

Merchant Brain will use Promptfoo or an equivalent approved harness for repeatable, synthetic evaluations. No production data, API keys, or assumed provider/model IDs are committed.

## Evaluation suites

- `evals/extraction/`: invoices, receipts, expenses, orders, malformed fields, OCR ambiguity, and schema validity.
- `evals/business-brain/`: explanations and classifications grounded in supplied records.
- `evals/hallucination/`: missing data, unsupported claims, fabricated values, and contradictions.
- `evals/rag/`: retrieval relevance, citation correctness, tenant boundaries, stale evidence, and “why” traceability.
- `evals/security/`: prompt injection, malicious documents, unauthorized requests, tool abuse, and data exfiltration attempts.
- `evals/regression/`: locked synthetic cases for every accepted prompt/model behavior.

## Required assertions

Evaluate factual accuracy, evidence/source grounding, unsupported-claim rate, structured-output validity, refusal behavior, prompt-injection resistance, unauthorized data requests, consistency across runs, latency, token/cost budgets, and model comparison. Use deterministic assertions for arithmetic and schema parsing wherever possible.

## Test data policy

Only synthetic fixtures belong in this repository. Every case states its expected facts, allowed evidence, forbidden claims, tenant scope, and expected refusal or review state. Never paste real merchant, personal, financial, provider, or secret data into prompts, snapshots, logs, or reports.

## Promptfoo preparation

Prompt definitions live under `prompts/` and are versioned. An eventual `promptfooconfig.yaml` must select provider/model values from CI secrets or environment variables and fail closed when no provider is configured. Do not put a current model ID in a committed example merely to make a config look complete.

The AI-eval workflow is manual/explicit by design. It must not silently spend provider credits on every pull request. A run should publish the Promptfoo report as a protected artifact and fail on configured quality gates.

## Review protocol

1. Add or update a synthetic case.
2. Run the relevant suite against the candidate and baseline.
3. Inspect failures for both false positives and false negatives.
4. Review prompts and model routing for privacy, security, cost, and evidence changes.
5. Record the decision, date, provider/model metadata, and known gaps in the pull request.
