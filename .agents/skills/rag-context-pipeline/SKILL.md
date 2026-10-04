---
name: rag-context-pipeline
description: Work on retrieval, chunking, embeddings, context assembly, or the pgvector query. Use when editing modules/rag/**, context-compiler.ts or untrusted.ts, document_embeddings, match_document_embeddings, chunk storage, redaction, retrieval thresholds, topK, or context/token budgets; when the context window is overflowing or too much text is sent to the model; and when deciding whether retrieved text may be shown to a model. Encodes the redaction-before-embedding invariant, the tenant re-check in SQL, and the fact RAG is not yet wired in production.
---

# RAG and context compilation

RAG supplies **unstructured context**, never amounts or identities. Structured facts stay in SQL.
A vector is not reversible: anything indexed becomes a durable copy, which is why redaction happens
on the way **in**.

## Flow

```
chunk (rag-chunker.v1) → redact → embed (1536) → document_embeddings
                                                 ↓
query → embed → ANN search → threshold → dedupe → budget → compile → prompt
```

**Chunking** (`modules/rag/domain/chunking.ts:20-46`): ~1200 chars, max 1600, 200-char sentence
overlap, `contentHash` for dedupe.

**Redaction** (`modules/rag/domain/redaction.ts`): deterministic and idempotent, runs **before**
embedding. Credentials, tax ids, bank/IFSC, card numbers, phone, email → typed placeholders.
Trading-partner names, product names, and amounts are **deliberately kept** — stripping them would
destroy retrieval value. The compensating control is tenant scoping, not redaction. Never "improve"
redaction by deleting business terms.

**Embedding**: `EMBEDDING_DIMENSIONS = 1536` must match `document_embeddings.embedding vector(1536)`.
A wrong-width vector is rejected by Postgres; the provider treats a dimension mismatch as a hard
failure rather than truncating. Changing embedding models requires a migration.

**Retrieval SQL**: `business_id = $1` must appear in the `WHERE` **and** the `JOIN`
(`modules/rag/infrastructure/chunk-repository.ts:87-89`), plus an in-code re-check (`:283`).
`match_document_embeddings` (`20261002000010:111`) is `SECURITY DEFINER`, re-validates the tenant
against `auth_user_businesses()`, converts distance to similarity `1 - dist`, applies a threshold,
filters on `metadata->>'sourceType'`, and clamps `LIMIT` to `[1,50]`. Because the tenant check runs
after the ANN scan, recall can under-return but **cannot leak**.

**Policy** (`modules/rag/domain/retrieval-policy.ts:42-51`): similarity floor 0.35, topK ≤ 8, 4×
over-fetch, ≤ 2 chunks per document, hash dedupe, 8000-char budget, freshness flag.

**Context budget** (`modules/business-brain/application/context-compiler.ts:51-56`): 8 tool results,
60 metrics, 8 evidence items, 24 000 chars.

## Not wired in production

`PgChunkStore` and `DefaultRAGService` appear only in `modules/rag/index.ts` and tests.
`wireBusinessBrain` (`lib/ai/composition.ts:39-42`) builds the context assembler with **no
retriever**, so `retrievalEnabled` is permanently `false`. README:73's "RAG context" claim is false.
Do not write a review that assumes retrieval is live.

## Injection defense

Retrieved text is data. Every chunk is wrapped as `<retrieved_evidence>` with source metadata by
`wrapUntrusted` (`modules/business-brain/application/untrusted.ts:47-80`). Preserve that wrapping
and never concatenate retrieved text into a system prompt. `rowToScoredChunk`
(`chunk-repository.ts:169-185`) returns `null` rather than inventing defaults when provenance is
missing — keep that; a fabricated source id is worse than a dropped chunk.

## Gotchas

- The HNSW index (`20261002000002:117`) is **not** partial, so unembedded rows are indexed.
- `search_path` on `match_document_embeddings` is widened to `public, extensions`
  (`20261002000010:133`) — the one privileged function not pinned to `''`.
- Dedup is hash-based within a query; it does not dedupe across turns.
- Context budget is characters, not tokens. Do not assume a token ceiling.
- The in-memory alert dedupe store in `notifications` is process-local.

## Validation

```bash
npx vitest run tests/rag
npm run typecheck && npm test
```

`tests/rag/{tenant-guard,prompt-injection,pipeline}.test.ts` are the enforcement points.
