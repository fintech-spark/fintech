# Phase 4 → 10 gap matrix and handoff

**Branch:** `feature/ai`
**Method:** four parallel read-only audits (providers · extraction+validation · RAG+business-brain ·
security+tests). No audit agent was permitted to write.
**Rule applied:** a capability is not COMPLETE because a file exists.

---

## 1. Concurrency situation — read this first

At the time of this audit another agent held live leases on the core AI paths:

| Scope | Note | TTL at audit |
|---|---|---|
| `lib/ai` | phase7+8 secure tools + rag context | ~2.5 h |
| `modules/rag` | phase7+8 rag pipeline | ~2.5 h |
| `modules/business-brain` | phase7+8 context compiler | ~2.5 h |
| `tests` | phase7+8 tests | ~2.5 h |

It was **actively writing** (files at 02:43, 02:44, 02:45). Those paths were
therefore treated as read-only. Work in this session was confined to paths no
lease covered:

- `evals/**` — the Phase 10 evaluation framework
- `modules/validation/**` — Phase 6 validation service
- `package.json` — the `eval` script only

No file owned by the other agent was modified, reverted, or staged.

---

## 2. Consolidated gap matrix

Status key: **C** complete · **P** partial · **M** missing · **I** incorrect · **S** insecure · **U** untested

### Phase 4 — provider foundation

| Capability | Status | Evidence |
|---|---|---|
| Provider adapter for Gemini/Claude/OpenAI | C | `lib/ai/providers/vercel-ai-adapter.ts:209` |
| SDK deps installed *and* imported | C | `package.json:31-33`; import `:32-35` |
| Any runtime caller of the adapter | **M** | zero importers outside a test double |
| Composition root / DI wiring | **M** | nothing constructs it; `app/` has 3 files |
| Router (role → model) | **P** dead | `lib/ai/router/index.ts:21`, zero callers |
| `responseFormat:'json'` honoured | **I** | declared `types.ts:41`, never read in `complete()` |
| `request.tools` honoured | **I** | declared `types.ts:40`; extraction path unreachable `:386` |
| Multimodal image → SDK part | **I** | `:372-377` both branches identical; SDK needs `image:` |
| Timeout classification | **I** | own timeout → `unknown`, non-retryable `:318` vs `:110-112` |
| Retry / capped backoff | C | `:330-358` |
| Abort in-flight on timeout | **M** | `Promise.race` only, no `AbortSignal` `:314-327` |
| Structured output via Zod | P | `lib/ai/guards/index.ts:17` |
| Capability metadata | **M** | no capability type exists at all |
| `server-only` coverage | P | adapter only; `model-config`, `router`, `guards` unguarded |
| Adapter tests | **M** | zero |

### Phase 5 — extraction

| Capability | Status | Evidence |
|---|---|---|
| Pipeline + file magic-byte validation | C | `extraction-service.ts:189-282`; `file-validation.ts:86-128` |
| Entity Zod schemas | C | `lib/ai/schemas.ts:19,38,48` |
| Confidence semantics | **I** | every field hardcoded `medium` `extraction-service.ts:462-468`; `classifyConfidence(1)` unreachable `:497` so `high` is never produced |
| Field-level evidence | **M** | model `evidence[]` discarded `:448`; `evidenceOf()` dead `:501` |
| Schema family selection | **I** | any image/pdf → invoice schema `file-validation.ts:290-299` |
| Provenance page/span | **M** | absent from types and table |
| OCR | **M** | vision path sends raw base64; no OCR engine |
| Injection defence, text path | C | `prompt-builder.ts:91-106` |
| Injection defence, **vision path** | **P** | scanned image reaches model unwrapped `:321,425-431` |
| Persistence + route | **M** | `infrastructure/` holds only file-validation |

### Phase 6 — validation + evidence  ← addressed this session

| Capability | Status before | Status after |
|---|---|---|
| Required-field check | **I** — fired only at >2 missing | **C** |
| Line-item arithmetic | **U** unreachable on real data | **C** |
| Subtotal / total arithmetic | **U** unreachable | **C** |
| Conflict representation | **P** free text only | C (`CONFLICTING` evidence → REJECTED) |
| Embedded-instruction detection | **M** | **C** (forces review) |
| Empty `lineItems` treated as present | **I** | **C** |
| `businessId`/`documentId` from caller, cast | **S** | P — still caller-supplied, now overridable |
| Status determination | **I** everything VALIDATED | **C** |
| **Tests** | **none** | **23 assertions** |

### Phase 7 — secure tools  (built by the other agent; audit only)

| Capability | Status | Evidence |
|---|---|---|
| Explicit allowlist, no dynamic register | C | `registry.ts:136-146` |
| Unknown tool rejected | C | `:195-197` |
| Strict Zod tool inputs | C | `:288`; all inputs `.strict()` |
| Tool outputs validated | **P** | `metrics: z.array(z.unknown())` `sales-tools.ts:61` — no-op |
| Tool-call budget | C | `:190`, `types.ts:95` |
| Tenant never model-supplied | C | tools read `ctx.tenant.businessId`; tenant keys rejected `schemas.ts:37-50` |
| No model-derived SQL | C | all bound `chunk-repository.ts:72-102` |
| Citation fabrication unenforced | **P** | `citableIds` is prompt guidance only; no response validator |
| Multi-currency evidence id collision | **S** | `context-compiler.ts:117` id omits currency → silent dedupe |

### Phase 8 — RAG

| Capability | Status | Evidence |
|---|---|---|
| Deterministic chunker | C | `chunking.ts:67,163` |
| pgvector + HNSW | C | migrations `…_init_extensions.sql:17`, `…_indexes.sql:117-119` |
| Retrieval tenant-scoped | C | `e.business_id = $1` `chunk-repository.ts:89` from `ctx` |
| Chunk content hash | **I** | hashes whole document → dedup collapses a whole doc to 1 hit `:103` |
| Batch embedding index alignment | **I** | failed batch shifts vectors into wrong slots `embedding-provider.ts:124-141` |
| `topK` honoured | **I** | always uses `defaultTopK` `retrieval-policy.ts:75` |
| Structural tenant guard on retrieval SQL | **M** | `chunk-repository.ts:264` bypasses `assertTenantPredicate` |
| Page provenance forwarded | **M** | `pageNumber/pageCount` never passed `rag-service.ts:70-79` |
| Runtime wiring | **M** | nothing constructs chunk store / RAG service / assembler |
| Prompt region separation | C | `prompt-builder.ts:141,158,177,211` |
| Context budget | C | `context-compiler.ts:53-58` |
| Embedding dimension | **I** | default 3072-dim vs hardcoded 1536 |
| Real-DB retrieval test | **M** | no test touches Postgres/pgvector |

### Phase 9 — Business Brain

| Capability | Status |
|---|---|
| Context compiler + origin per item | C |
| Evidence packet, server-minted ids | C |
| Prompt assembly | C |
| **Model call** | **M** — the assembled prompt is a string with no consumer |
| **HTTP-reachable route** | **M** — `app/` exposes only `/api/health` |

### Phase 10 — evaluation  ← addressed this session

| Capability | Status before | Status after |
|---|---|---|
| `promptfooconfig.yaml` | empty — ran 0 cases | unchanged, with rationale |
| `npm run eval` | **M** | **C** |
| Validation fixtures | 11 files, inert, shape did not match the validator | **C** — adapter + 23 assertions, all passing |
| Extraction fixtures | 4 files, inert | P — fixtures present, not yet graded |
| Provider-backed evals | **M** | **M** — blocked on model/budget/secret approval |

---

## 3. Highest-severity findings, for the owning agent

| # | Severity | Finding | Location |
|---|---|---|---|
| 1 | **CRITICAL** | No composition root: nothing builds the provider adapter, chunk store, RAG service or context assembler, and `app/` has no AI route. The entire AI layer is unreachable from a request. | repo-wide |
| 2 | **CRITICAL** | Validation returned `VALIDATED` for injected, duplicated, unsupported and evidence-less documents. **Fixed this session** — 13 of 20 assertions failed before the fix. | `modules/validation` |
| 3 | **HIGH** | Multimodal image parts never reach the SDK correctly — both mapping branches are identical. Scanned invoices (the primary Merchant Brain input) cannot be extracted. | `vercel-ai-adapter.ts:372-377` |
| 4 | **HIGH** | Scanned documents bypass the untrusted-content wrapper, so injected text in an image reaches the model undelimited. | `extraction-service.ts:321` |
| 5 | **HIGH** | Embedding batch results are not index-aligned; a partial failure silently drops correctly embedded chunks from the index. | `embedding-provider.ts:124-141` |
| 6 | **HIGH** | Chunk dedup key is a per-document hash, collapsing all chunks of a document to a single hit and defeating `maxChunksPerDocument`. | `chunking.ts:103` |
| 7 | **HIGH** | Multi-currency tenants collide on evidence id, so one currency's figure becomes uncitable. | `context-compiler.ts:117` |
| 8 | **MEDIUM** | `responseFormat` and `tools` are silently ignored by the provider path. | `types.ts:40-41` |
| 9 | **MEDIUM** | Retrieval SQL bypasses the structural tenant predicate guard. | `chunk-repository.ts:264` |
| 10 | **MEDIUM** | Merchant question length is uncapped; only the embedding copy is bounded. | `context-assembler.ts:161` |
| 11 | **MEDIUM** | Delimiter neutralisation is exact-case; `</retrieved_evidence >` survives. | `untrusted.ts:49-55` |
| 12 | **LOW** | A model timeout is classified `unknown`, so it is never retried. | `vercel-ai-adapter.ts:318` |

---

## 4. Work completed this session

| Change | Path |
|---|---|
| Eval config reusing the vitest `@/` alias, no new dependency | `evals/vitest.eval.config.ts` |
| Fixture → `ExtractionResult` adapter | `evals/runner/adapter.ts` |
| Named deterministic graders | `evals/runner/graders.ts` |
| Phase 6 evaluation, 23 assertions | `evals/validation/validation.eval.test.ts` |
| `npm run eval`, `npm run eval:watch` | `package.json` |
| Validator: required-field, arithmetic, conflict, embedded-instruction and status logic | `modules/validation/application/service.ts` |
| `CONFLICTING` evidence added so the conflict fixture is machine-detectable | `evals/validation/fixtures/conflicting-evidence.json` |

## 5. Verification

| Check | Result |
|---|---|
| `npm run lint` | pass — 0 errors, 0 warnings |
| `npm run typecheck` | pass — 0 errors |
| `npm run eval` | pass — 23/23 |
| `npm test` | 333 pass, 29 skipped, 1 file failed |
| `npm run build` | not run this session |

`tests/database-security.test.ts` cannot connect to `127.0.0.1:54322` and hangs in
`beforeAll`, skipping its 29 tests. The port is open but no connection completes.
This is **not** caused by this session's changes — it fails identically on
`feature/backend`, whose tree this session did not touch. Cause not established.

## 6. Handoff

Unblocked and safe to pick up, in priority order:

1. Composition root + one AI route (finding 1) — without it nothing else is reachable.
2. Findings 3–6 in `lib/ai` and `modules/rag`.
3. Extraction confidence and field-level evidence (Phase 5).
4. Provider-backed evals once a model, budget and secret policy are approved.
5. Phase 9 reasoning, Phase 11 multi-model verification: both `MISSING`, correctly,
   because no model call exists yet.

Paths still leased by the other agent: `lib/ai`, `modules/rag`,
`modules/business-brain`, `tests`.