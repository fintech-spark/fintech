# Evaluation suites

Promptfoo preparation is split by risk and behavior. Use only synthetic cases. Provider and model configuration remains external and explicit; no evaluation calls run automatically without credentials.

- `extraction/` — field extraction and schema validity.
- `business-brain/` — grounded analysis and explanations.
- `hallucination/` — missing/conflicting evidence and unsupported claims.
- `rag/` — retrieval/citation/tenant grounding.
- `security/` — injection, unauthorized requests, tool abuse, and leakage.
- `regression/` — locked cases for approved behavior.

## Runnable gates

`npm run eval` runs offline fixtures and deterministic graders without loading credentials or contacting providers.

Provider-backed synthetic evaluation uses the installed Vercel SDK through `VercelAIProviderAdapter`:

```bash
AI_EVAL_LIVE=1 npx vitest run --config evals/vitest.live.config.ts
# Optional: AI_EVAL_PROVIDER=google|openai|anthropic and AI_EVAL_MODEL=<configured-model-id>
```

The live config loads server credentials from the environment or `.env.local`/`.env`, fails if opt-in or the selected provider's credentials are missing, and sends only fixtures declared in `evals/provider/cases.ts`. It covers recorded numbers/citations, absent and conflicting evidence, stale sources, document injection, unauthorized-tenant requests, tool abuse, unsupported actions, and invoice extraction. The production adapter enforces schema-constrained output; graders check exact fixture expectations without repairing output or asking a model to judge itself. A provider failure fails the live suite rather than falling back to a passing offline answer.

Output contains case names, model/provider, measured latency/token usage, and grader outcomes. It never prints credential values, headers, full prompts, or raw responses. Passing these cases demonstrates those specific synthetic expectations; it is not a general hallucination-rate or production-database claim.

The 2026-10-05 live synthetic run passed all nine cases with `AI_EVAL_PROVIDER=google AI_EVAL_MODEL=gemini-3.1-flash-lite`. Model discovery alone did not establish generation availability: `gemini-2.5-flash` returned HTTP 404 and `gemini-3-flash-preview` returned HTTP 503. Choose the deployment's `AI_MODEL_*` explicitly and evaluate that model rather than assuming a role default works. Offline adversarial mutations also cover signs, scientific notation, supplied versus invented dates, exact excerpts and financial unit/currency changes.
