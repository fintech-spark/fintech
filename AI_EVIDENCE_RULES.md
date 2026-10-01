# AI evidence rules

Evidence is a product requirement for important AI-generated claims, not optional decoration.

## Claim envelope

A material insight, answer, risk, leak, scenario result, or recommendation should eventually carry a structured envelope containing:

- **Claim:** concise statement in plain language.
- **Claim type:** fact, deterministic calculation, interpretation, recommendation, or draft.
- **Supporting evidence:** what was observed and how it supports the claim.
- **Source IDs:** stable IDs for authorized documents, transactions, messages, or calculations.
- **Affected records:** record IDs and tenant scope; never expose records the viewer cannot access.
- **Impact:** a verified amount, range, quantity, or qualitative impact with units and period.
- **Explanation:** the reasoning chain, assumptions, and relevant limitations.
- **Confidence:** evidence quality/coverage label or calibrated score, never an unsupported model self-rating.
- **Freshness:** source timestamps and last verified time.
- **Conflicts:** known contradictory records or unresolved gaps.
- **Policy metadata:** prompt version, model role, schema version, and review status.

## Grounding requirements

1. Build context from authorized application records, not untrusted model memory.
2. Require at least one source reference for any claim presented as a business fact.
3. Use deterministic calculations for arithmetic and show the inputs or formula when useful.
4. Refuse or label claims that cannot be traced to verified data.
5. Preserve provenance through extraction, normalization, analysis, and presentation.
6. Do not cite a document merely because it was retrieved; the cited passage/field must support the claim.
7. If evidence is partial, stale, low quality, or conflicting, present the limitation next to the claim.

## UI requirement

Important insight surfaces must provide a visible **Why am I seeing this?** control. The detail view should show source type, timestamp, record ID, relevant field or excerpt, calculation inputs, and conflicts. It must respect authorization and redact sensitive values as needed.

## Review states

Use explicit states such as `unverified`, `needs_review`, `verified`, `rejected`, and `stale`. A reviewer approval may change workflow state, but it does not rewrite source records or grant authorization.

## Evaluation

Evals must test missing evidence, irrelevant evidence, contradictory records, fabricated citations, tenant boundary violations, and stale source handling. See `EVALS.md` and `evals/rag/`.
