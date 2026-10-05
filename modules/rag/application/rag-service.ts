// Merchant Brain: RAG ingestion and retrieval
//
// PIPELINE
//   redact -> chunk -> embed -> persist -> (query) embed -> tenant-scoped ANN
//   -> threshold/dedup/diversity -> evidence
//
// ORDERING IS LOAD-BEARING
//   * Redaction runs before embedding, because a vector cannot be un-leaked.
//   * Chunking runs before embedding, because one vector per chunk is what makes
//     provenance addressable at all.
//   * Embedding runs before the delete-and-replace, so a provider outage
//     leaves the previous good vectors in place instead of emptying the index.
//
// PARTIAL FAILURE IS REPORTED, NEVER SWALLOWED
//   If some chunks fail to embed, `IndexingOutcome.failures` says which and
//   why. A silent zero would leave a document half-indexed with no record that
//   anything went wrong.

import type { TenantContext, DocumentId } from '@/lib/types';
import { chunkText } from '../domain/chunking';
import { redactForEmbedding } from '../domain/redaction';
import {
  applyRetrievalPolicy,
  assessFreshness,
  resolveCandidateCount,
  resolveTopK,
  DEFAULT_RETRIEVAL_POLICY,
} from '../domain/retrieval-policy';
import type {
  IndexingOutcome,
  IngestionSource,
  RetrievalRequest,
  RetrievalResult,
} from '../domain/types';
import type { ChunkStore, EmbeddableChunk } from '../infrastructure/chunk-repository';
import type { EmbeddingProvider } from './embedding-provider';
import type { ChunkTextSource, RAGService } from './service';

/** Ceiling on the text handed to the embedding provider for a query. */
export const MAX_QUERY_CHARS = 2000;

/** Ceiling on source text accepted for a single indexing run. */
export const MAX_SOURCE_CHARS = 400_000;

export interface RAGDependencies {
  readonly store: ChunkStore;
  readonly embeddings: EmbeddingProvider;
  /** Optional: required only by `indexDocument`. */
  readonly sources?: ChunkTextSource;
  readonly now?: () => Date;
}

export class DefaultRAGService implements RAGService {
  private readonly store: ChunkStore;
  private readonly embeddings: EmbeddingProvider;
  private readonly sources: ChunkTextSource | undefined;
  private readonly now: () => Date;

  constructor(dependencies: RAGDependencies) {
    this.store = dependencies.store;
    this.embeddings = dependencies.embeddings;
    this.sources = dependencies.sources;
    this.now = dependencies.now ?? (() => new Date());
  }

  async index(ctx: TenantContext, source: IngestionSource): Promise<IndexingOutcome> {
    const text = source.content.slice(0, MAX_SOURCE_CHARS);
    const redacted = redactForEmbedding(text);

    const chunks = chunkText({
      businessId: ctx.businessId,
      documentId: source.documentId,
      sourceId: source.documentId,
      sourceType: source.sourceType,
      documentSourceType: source.documentSourceType,
      content: redacted.text,
      ...(source.fileName ? { fileName: source.fileName } : {}),
      ...(source.sourceTimestamp ? { sourceTimestamp: source.sourceTimestamp } : {}),
    });

    if (chunks.length === 0) {
      return {
        documentId: source.documentId,
        chunkCount: 0,
        embeddedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        failures: [],
      };
    }

    // Embed before mutating: a provider failure must not empty a live index.
    const batch = await this.embeddings.embedBatch(chunks.map((chunk) => chunk.content));
    const failedByIndex = new Map(batch.failures.map((f) => [f.index, f.reason]));

    const embeddable: EmbeddableChunk[] = [];
    const failures: { chunkIndex: number; reason: string }[] = [];

    chunks.forEach((chunk, index) => {
      const reason = failedByIndex.get(index);
      if (reason !== undefined) {
        failures.push({ chunkIndex: chunk.metadata.chunkIndex, reason });
        return;
      }
      const vector = batch.vectors[index];
      if (!vector) {
        failures.push({ chunkIndex: chunk.metadata.chunkIndex, reason: 'embedding missing' });
        return;
      }
      embeddable.push({
        documentId: source.documentId,
        content: chunk.content,
        metadata: { ...chunk.metadata, embeddingModel: this.embeddings.model },
        embedding: vector,
      });
    });

    if (embeddable.length === 0) {
      return {
        documentId: source.documentId,
        chunkCount: chunks.length,
        embeddedCount: 0,
        skippedCount: 0,
        failedCount: failures.length,
        failures,
      };
    }

    let written: number;
    if (this.store.replaceByDocument) written = await this.store.replaceByDocument(ctx.businessId,source.documentId,embeddable);
    else {
      await this.store.deleteByDocument(ctx.businessId, source.documentId);
      written = await this.store.save(ctx.businessId, embeddable);
    }

    return {
      documentId: source.documentId,
      chunkCount: chunks.length,
      embeddedCount: embeddable.length,
      skippedCount: written === embeddable.length ? 0 : chunks.length - embeddable.length,
      failedCount: failures.length,
      failures,
    };
  }

  async indexDocument(ctx: TenantContext, documentId: DocumentId): Promise<IndexingOutcome> {
    if (!this.sources) {
      throw new Error('indexDocument requires a ChunkTextSource');
    }
    const loaded = await this.sources.loadText(ctx.businessId, documentId);
    if (!loaded) {
      // No text is not a failure and not an empty success: it is absent
      // evidence, which the compiler is told about explicitly.
      return {
        documentId,
        chunkCount: 0,
        embeddedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        failures: [],
      };
    }

    return this.index(ctx, {
      documentId,
      content: loaded.content,
      sourceType: loaded.sourceType,
      documentSourceType: loaded.documentSourceType,
      ...(loaded.fileName ? { fileName: loaded.fileName } : {}),
      ...(loaded.sourceTimestamp ? { sourceTimestamp: loaded.sourceTimestamp } : {}),
    });
  }

  async retrieve(ctx: TenantContext, request: RetrievalRequest): Promise<RetrievalResult> {
    const topK = resolveTopK(request.topK);
    const query = redactForEmbedding(request.queryText.slice(0, MAX_QUERY_CHARS)).text;
    const queryEmbedding = await this.embeddings.embed(query);

    const candidates = await this.store.search(ctx.businessId, {
      queryEmbedding,
      limit: resolveCandidateCount(topK),
      minSimilarity: request.minScore ?? DEFAULT_RETRIEVAL_POLICY.minSimilarity,
      ...(request.sourceTypes ? { sourceTypes: request.sourceTypes } : {}),
      ...(request.documentSourceTypes
        ? { documentSourceTypes: request.documentSourceTypes }
        : {}),
    });

    // Candidates are filtered first and counted against afterwards: dropping a
    // chunk for threshold, duplication or budget must not shrink the answer
    // below the topK the caller asked for while fresher candidates sit unused
    // in the over-fetched set.
    const filtered = applyRetrievalPolicy(candidates, DEFAULT_RETRIEVAL_POLICY, { topK });

    return {
      chunks: filtered.kept,
      queryEmbedding,
      suppressed: filtered.suppressed,
      retrievedAt: this.now().toISOString(),
    };
  }

  async removeDocument(ctx: TenantContext, documentId: DocumentId): Promise<void> {
    await this.store.deleteByDocument(ctx.businessId, documentId);
  }
}

/** Freshness verdict for each retrieved chunk, keyed by chunk id. */
export { assessFreshness };
