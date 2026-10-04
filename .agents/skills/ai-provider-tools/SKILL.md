---
name: ai-provider-tools
description: Extend or review the AI layer — provider adapter, model routing, extraction pipeline, AI tools, evidence, and the Business Brain chat path. Use when editing lib/ai/**, modules/extraction/**, modules/business-brain/**, modules/evidence/**, prompts/**, or when a model call returns malformed output, wrong model, fabricated numbers, or a tool can be invoked outside its allowlist. Encodes the read-only tool invariant, tenant-key ban, evidence-derived confidence, and the current structured-output and grounding gaps.
---

# AI providers, tools, and grounding

The rule that outranks everything here: **deterministic code computes money; the model only
interprets.** A model must never produce a figure, authorize anything, or reach SQL.

## Provider adapter

`lib/ai/providers/vercel-ai-adapter.ts` is the only file that imports a vendor SDK
(`@ai-sdk/google|anthropic|openai`). It is `server-only` and calls
`assertNoPublicServiceRole()`. `lib/ai/providers/types.ts` declares the port every module depends on.

Five model roles map to env keys (`lib/ai/model-config.ts`): `multimodal`, `reasoning`, `fast`,
`reviewer`, `embedding` → `AI_MODEL_MULTIMODAL|REASONING|FAST|REVIEWER|EMBEDDING`. Unset falls back
to defaults; Anthropic has no embedding model and throws loudly if asked.

Failures are normalised into 8 categories (`categoriseFailure`); only transient ones retry, with
capped backoff.

## Known gaps — check these before claiming AI correctness

- **Structured output is not actually enforced.** The adapter sends `Output.json()` (JSON *mode*,
  no schema) at `vercel-ai-adapter.ts:243`. The SDK supports `Output.object({ schema })`; it is
  unused. There is no Zod validation inside the adapter, and the `result.text || ''` fallback turns
  empty output into a *successful* stop. Extraction fails closed downstream via `guardJSON` →
  `AIValidationError`; **Business Brain has no such guard.**
- **Business Brain drops the evidence.** `modules/business-brain/application/service.ts:90-106`
  passes `systemPrompt: assembly.prompt.system` and a message list containing only conversation
  history and the wrapped user question. `assembly.prompt.user` — every `<trusted_facts>`,
  `<deterministic_metrics>`, `<retrieved_evidence>` block — is **never sent**. The model is asked a
  financial question with no business data. If you touch this path, fix it before shipping.
- `catch {}` at `service.ts:110` swallows every provider error, and the grounded
  `buildDeterministicAnswer` path only runs when the adapter is absent.
- `modelUsed` records the *requested* model id, not the resolved one after the env override, so
  telemetry is wrong by construction.
- Sessions are keyed by `sessionId` alone (`service.ts:40`) with no tenant component — cross-tenant
  history bleed.
- `lib/ai/router/` and `lib/ai/telemetry/` are dead code (no production callers).

## AI tools — the read-only invariant

`lib/ai/tools/registry.ts` is the only door to a tool; the set is fixed at construction with no
runtime `register()`. Each call passes: call budget → allowlist → role gate → **required**
authorizer → tenant-key scan → strict Zod input → timeout → strict Zod output → payload size.

Defaults (`lib/ai/tools/types.ts:94-101`): 8 tool calls, 64 KB result, 100 rows, 366-day window,
500 chars of text, 5s timeout.

Non-negotiables when adding a tool:
- `readOnly: true` — enforced by literal type **and** a constructor throw
- input schema must not accept `businessId`/`tenant_id` (`FORBIDDEN_TENANT_KEYS`)
- SQL must carry `business_id = $1` (`tenant-query.ts:72-79` refuses otherwise)
- errors must be `AppError` subclasses, not bare `Error`
- the authorizer closure in `lib/ai/composition.ts:32-36` must compare tenant identity and throw
  `AuthorizationError`

The 11 registered tools (`modules/business-brain/application/tools/index.ts:46-60`) are all
read-only. There is currently **no production action executor** — `ActionExecutorRegistry` is never
registered or frozen outside tests, so AI-proposed actions cannot execute. That is safe by
incompleteness, not by design; do not assume it.

## Extraction

`modules/extraction/application/extraction-service.ts`: file validation → prompt build → provider
call (no tools ever attached) → `guardJSON` → per-family strict Zod → evidence-derived confidence →
persist as a **candidate** only. `validate()` hard-throws "Phase 6 scope" (`:292-298`); the
repository contract explicitly forbids writing authoritative business rows.

Confidence is derived from evidence, never from the model's self-rating: uncited → medium,
cited-without-excerpt → low, excerpt mismatch → low, corroborated → high; the overall value is the
**lowest** field and review can only lower it.

## Gotchas

- `prompts/*.md` are **documentation only** — nothing loads them at runtime. The live versions are
  string constants (`EXTRACTION_PROMPT_VERSION`, `CONTEXT_PROMPT_VERSION`). Changing a prompt means
  changing the constant and bumping the version.
- Delimiter wrapping *is* real at runtime: `<merchant_document>` with delimiter neutralisation
  (`prompt-builder.ts:91-106`), `<retrieved_evidence>` per chunk
  (`business-brain/application/untrusted.ts:47-80`). Preserve it whenever you build a prompt.
- `getResult(ctx, extractionId)` passes the **extraction id** into `findByDocument`
  (`extraction-service.ts:288`) — wrong lookup key, currently returns null.
- AI Zod schemas in `lib/ai/schemas.ts` are not `.strict()`, so unknown keys are stripped rather
  than rejected.
- Provider timeout uses `Promise.race` without an `abortSignal`; the vendor request keeps running
  and billing after we give up.

## Validation

```bash
npx vitest run tests/ai-tools tests/rag tests/extraction tests/business-brain
npm run eval        # offline only; currently runs a single validation file
npm run typecheck && npm test
```

## References

- `.agents/rules/ai-engineering.md` — standing AI engineering policy
- `docs/ai/AI_RULES.md`, `docs/ai/AI_EVIDENCE_RULES.md` — the authoritative AI rules
- `.agents/skills/ai-sdk/SKILL.md` — SDK API reference (verify against it; do not code from memory)
