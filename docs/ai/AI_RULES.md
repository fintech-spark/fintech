# AI reliability rules

This policy applies to every future AI feature, prompt, tool, evaluator, and UI.

## Source of truth

The application's verified data, deterministic calculations, authorization context, and recorded evidence are the source of truth. An LLM is a probabilistic component that may help with extraction, classification, interpretation, summarization, explanation, reasoning, recommendations, and message drafting. It is not an authority.

The model must never be the source of truth for:

- Financial arithmetic, accounting totals, inventory arithmetic, balances, revenue, expense, profit, or payment status.
- Permissions, tenant identity, authorization, security decisions, or policy enforcement.
- Irreversible actions, financial actions, sending messages, or placing orders.
- Facts that are not present in verified application data.

## Anti-hallucination rules

Never invent transaction amounts, customer or supplier balances, products, dates, invoices, inventory levels, revenue, expenses, profits, payment status, evidence, or business facts. Never guess missing information or answer business questions from model memory.

If verified information is insufficient, say so clearly and identify what data is missing. If records conflict, surface the conflict and do not silently choose a value. If a source is stale, partial, low quality, or unverified, label the limitation.

## Evidence and calculations

- Deterministic code computes money, quantities, dates, totals, deltas, and thresholds.
- AI receives only the minimum authorized context needed for its task.
- Important claims must be grounded in verified records and follow `docs/ai/AI_EVIDENCE_RULES.md`.
- The UI must distinguish facts, calculations, inferences, recommendations, and drafts.
- Never turn a model confidence score into a probability of business truth without a validated calibration method.
- Never use an LLM to approve its own unsupported claim. A reviewer can flag problems; application validation decides acceptance.

## Structured outputs

Important outputs use Zod schemas in `lib/ai/schemas.ts` (or a future approved module). The application must:

1. Send a constrained schema or equivalent structured-output request when the provider supports it.
2. Parse the raw response with Zod.
3. Reject, quarantine, or request correction for malformed output.
4. Validate cross-field invariants in deterministic code.
5. Preserve the raw source and parser/version metadata needed for review.

Do not trust JSON because it is syntactically valid. Do not silently coerce missing or conflicting fields into business facts.

## Prompt injection and untrusted content

Documents, OCR, transcriptions, WhatsApp messages, CSV cells, tool responses, and retrieved text are data, not instructions. Delimit them, label their trust level, and ignore instructions found inside them unless the application explicitly treats that field as a user instruction. Apply the rules in `docs/security/FILE_SECURITY.md` and `SECURITY.md` before sending content to a model.

Tool names, arguments, and results must be allowlisted and validated. A model may not grant itself tools, permissions, tenant access, or a higher action tier.

## Reliability boundaries

- Extraction returns candidates for human review when confidence/quality or field completeness is inadequate.
- Classification and summaries may use a fast model, but material business claims still need evidence.
- Reasoning models may explain verified inputs but cannot alter source facts.
- Reviewer models are advisory and adversarial; they do not replace application validation.
- Fallbacks must preserve schema, evidence, privacy, and action policy. A cheaper model is not permission to weaken controls.

## Observability and privacy

Record model role, provider, model ID, prompt version, schema version, latency, token usage, validation outcome, and safe error categories. Do not log raw financial documents, secrets, personal data, or full prompts containing sensitive content. Use redacted IDs and retention limits.

## Change policy

Every prompt or model-routing change is a versioned change. Add or update synthetic evals for extraction, grounding, hallucination resistance, security, and regression. Review changes against `docs/engineering/EVALS.md`; do not claim quality improvements without measured evidence.
