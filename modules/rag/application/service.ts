// Merchant Brain: RAG service ports
//
// The interfaces the host wires. `modules/rag` owns retrieval; it does not own
// storage layout, provider credentials, or document loading, so each of those
// arrives as a port.
//
// `retrieve` takes a `RetrievalRequest`, which has no tenant field. Tenant
// identity arrives only as `TenantContext`. That is the single most important
// property of this surface: there is no argument through which a caller — let
// alone a model — can name a tenant.

import type { TenantContext, DocumentId } from '@/lib/types';
import type { IndexingOutcome, IngestionSource, RetrievalRequest, RetrievalResult } from '../domain/types';

/** Loads indexable text for a document, scoped to the owning tenant. */
export interface ChunkTextSource {
  loadText(
    businessId: string,
    documentId: DocumentId,
  ): Promise<
    | {
        readonly content: string;
        readonly sourceType: IngestionSource['sourceType'];
        readonly documentSourceType: IngestionSource['documentSourceType'];
        readonly fileName?: string;
        readonly pageCount?: number;
        readonly sourceTimestamp?: string;
      }
    | null
  >;
}

export interface RAGIndexer {
  /** Chunks, redacts, embeds, and persists. Reports partial failure honestly. */
  index(ctx: TenantContext, source: IngestionSource): Promise<IndexingOutcome>;
  /** Convenience path for callers holding only a document id. */
  indexDocument(ctx: TenantContext, documentId: DocumentId): Promise<IndexingOutcome>;
}

export interface RagRetriever {
  retrieve(ctx: TenantContext, request: RetrievalRequest): Promise<RetrievalResult>;
}

export interface RAGService extends RAGIndexer, RagRetriever {
  removeDocument(ctx: TenantContext, documentId: DocumentId): Promise<void>;
}
