# AI cost management

AI spend is a product and reliability constraint. Cost controls are prepared here; no provider billing or model routing is configured yet.

## Routing

- Use the fast role for classification, categorization, short summaries, and simple drafting.
- Use multimodal only when the input modality requires it.
- Reserve reasoning models for material analysis and explanations that justify the added latency/cost.
- Use reviewer models selectively for high-impact claims, adversarial tests, and sampled quality checks.
- Route by task risk and evidence requirements, not by a model's marketing label.

## Measurement

Record provider, model ID, role, prompt/schema version, input/output tokens where available, latency, retry count, cache hit, and outcome. Aggregate by tenant and task without exposing raw content. Set per-request, per-user, per-tenant, and global budgets before production use.

## Controls

- Enforce token, file, context, time, concurrency, and retry limits.
- Cache only authorized, non-sensitive, versioned results with invalidation on source/prompt/model changes.
- Deduplicate identical work and avoid sending full documents when a bounded excerpt/field is enough.
- Use deterministic code for arithmetic and filters instead of model calls.
- Define safe fallback models and a clear unavailable state. Never generate filler to hide a failed provider.
- Rate-limit expensive routes and require review/confirmation for actions that can spend money.

## Governance

Track cost changes in AI evals and pull requests. A model upgrade or prompt expansion must show its quality, latency, privacy, and cost impact. Do not assume a model name or price remains available; verify official provider pricing and model documentation before configuring it.
