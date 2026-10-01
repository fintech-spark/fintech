import type { TenantContext, DocumentId } from '@/lib/types';
import type { RetrievalQuery, RetrievalResult, EmbeddingChunk } from '../domain/types';
export interface RAGService {
  indexDocument(ctx: TenantContext, documentId: DocumentId, content: string): Promise<readonly EmbeddingChunk[]>;
  retrieve(ctx: TenantContext, query: RetrievalQuery): Promise<RetrievalResult>;
  removeDocument(ctx: TenantContext, documentId: DocumentId): Promise<void>;
}
