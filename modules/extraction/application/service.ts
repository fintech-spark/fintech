import type { TenantContext, DocumentId } from '@/lib/types';
import type { ExtractionResult } from '../domain/types';
export interface ExtractionService {
  extract(ctx: TenantContext, documentId: DocumentId): Promise<ExtractionResult>;
  getResult(ctx: TenantContext, extractionId: string): Promise<ExtractionResult | null>;
  validate(ctx: TenantContext, extractionId: string): Promise<ExtractionResult>;
  getByDocumentId(ctx: TenantContext, documentId: DocumentId): Promise<readonly ExtractionResult[]>;
}
