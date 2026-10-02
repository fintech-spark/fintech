# Model strategy

This document prepares model selection without locking Merchant Brain to a provider or inventing model IDs. Credentials and production model IDs remain unset in `.env.example`.

## Role-based routing

| Role | Work | Requirements |
|---|---|---|
| Multimodal | Invoices, screenshots, receipts, PDFs, and voice-note inputs | Vision/audio/document support, extraction schema adherence, source localization, privacy controls. |
| Reasoning | Business analysis, explanation, root-cause reasoning | Strong reasoning over verified context, controlled output, evidence references, predictable latency budget. |
| Fast | Classification, categorization, summaries, and simple drafting | Low latency/cost, deterministic schema, short context, safe fallback. |
| Reviewer | Unsupported-claim checks, reasoning checks, hallucination and adversarial tests | Independent context, adversarial instructions, structured findings, no authorization power. |

## Provider preparation

The Vercel AI SDK and official provider packages for Google, Anthropic, and OpenAI are installed. Future provider clients must be created in one server-only boundary and selected by role. Do not scatter provider imports or model IDs through routes/components.

The configuration should read role mappings from server environment variables such as `AI_MODEL_MULTIMODAL`, `AI_MODEL_REASONING`, `AI_MODEL_FAST`, and `AI_MODEL_REVIEWER`. Empty configuration must fail clearly at the integration boundary rather than silently selecting a model.

## Selection rules

- Verify current model IDs, supported modalities, structured-output behavior, retention, regional availability, rate limits, and pricing in the provider's official documentation before configuring them.
- Store provider and model metadata with AI runs. A model name in a prompt or test is not a guarantee of current availability.
- Route by task and risk. Do not use an expensive reasoning model for trivial classification, and do not downgrade a high-risk task without an explicit reviewed policy.
- Define timeout, retry, fallback, and budget behavior per role. Retries must be bounded and idempotent.
- Fallbacks must maintain privacy, evidence, schema, and action policy. Provider failure must not become a fabricated answer.
- Reviewer models cannot authorize a claim, tool, user, tenant, or irreversible action.

## Evaluation gates

Before changing a role mapping, run representative synthetic evals for factual accuracy, evidence grounding, structured validity, prompt injection resistance, latency, cost, and consistency. Record provider/model IDs and eval date. See `docs/engineering/EVALS.md`.

## Not decided yet

No primary provider, model IDs, context-window policy, data-retention contract, regional policy, or production failover topology is approved. Those decisions depend on product flows, data contracts, compliance needs, and measured evals.
