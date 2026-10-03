// Merchant Brain: RAG domain contracts
//
// TENANT SCOPE IS NOT PART OF A RETRIEVAL QUERY.
//
// The pre-Phase-7 `RetrievalQuery` carried its own `businessId`, which made it
// possible for a caller to ask for another tenant's chunks. Tenant identity now
// comes only from `TenantContext` on the service method; `RetrievalRequest`
// below has no tenant field at all, so the mistake is unrepresentable rather
// than merely discouraged.
//
// `ScoredChunk.score` is a COSINE SIMILARITY in [-1, 1], higher is more
// similar. pgvector's `<=>` returns a distance, so the repository computes
// `1 - distance`; see `infrastructure/chunk-repository.ts`. The old contract
// left this undefined, which invited a sign error.

import type { DocumentId } from '@/lib/types';
import type { DocumentSourceType } from '@/modules/documents';

/** Categories of merchant context that can be indexed. */
export type ChunkSourceType =
  | 'document'
  | 'conversation'
  | 'note'
  | 'voice_transcript'
  | 'whatsapp';

/**
 * The document artefact kind a chunk was extracted from.
 *
 * Aliased from `modules/documents` rather than redeclared: `rag` is permitted to
 * depend on `documents`, and a second copy of this union would drift from the
 * `documents.source_type` CHECK constraint the retrieval filter matches on.
 */
export type IndexedDocumentSourceType = DocumentSourceType;

export interface ChunkMetadata {
  /** Tenant. Present on every chunk so provenance survives a round trip. */
  readonly businessId: string;
  readonly sourceId: string;
  readonly sourceType: ChunkSourceType;
  readonly fileName?: string;
  readonly pageNumber?: number;
  readonly chunkIndex: number;
  readonly totalChunks: number;
  /** Schema version of the chunker that produced this chunk. */
  readonly chunkerVersion: string;
  /** Model that produced the vector, so a dimension change is detectable. */
  readonly embeddingModel?: string;
  /** SHA-256 of the chunk text; the dedup and re-index signal. */
  readonly contentHash?: string;
  /** ISO timestamp of the event the text describes, when known. */
  readonly sourceTimestamp?: string;
}

export interface EmbeddingChunk {
  readonly id: string;
  readonly businessId: string;
  readonly documentId: DocumentId;
  readonly content: string;
  readonly metadata: ChunkMetadata;
  readonly embedding?: readonly number[];
  readonly createdAt: Date;
}

export interface ScoredChunk {
  readonly chunk: EmbeddingChunk;
  /** Cosine similarity, [-1, 1]. Higher is closer. */
  readonly score: number;
}

/**
 * A retrieval request. Deliberately has no `businessId`: see the file header.
 */
export interface RetrievalRequest {
  readonly queryText: string;
  /** Bounded by `RetrievalPolicy.maxTopK` regardless of what is asked for. */
  readonly topK?: number;
  readonly sourceTypes?: readonly ChunkSourceType[];
  readonly documentSourceTypes?: readonly IndexedDocumentSourceType[];
  readonly minScore?: number;
}

export interface RetrievalResult {
  readonly chunks: readonly ScoredChunk[];
  readonly queryEmbedding?: readonly number[];
  /** Chunks dropped by threshold, dedup, or diversity. Diagnostic only. */
  readonly suppressed: {
    readonly belowThreshold: number;
    readonly duplicates: number;
    readonly overBudget: number;
  };
  readonly retrievedAt: string;
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

export interface IngestionSource {
  readonly documentId: DocumentId;
  readonly sourceType: ChunkSourceType;
  readonly documentSourceType: IndexedDocumentSourceType;
  readonly fileName?: string;
  readonly pageCount?: number;
  readonly content: string;
  readonly sourceTimestamp?: string;
}

export interface IndexingOutcome {
  readonly documentId: DocumentId;
  readonly chunkCount: number;
  readonly embeddedCount: number;
  readonly skippedCount: number;
  /** Chunks the embedding provider refused. Never silently zero. */
  readonly failedCount: number;
  readonly failures: readonly { readonly chunkIndex: number; readonly reason: string }[];
}
