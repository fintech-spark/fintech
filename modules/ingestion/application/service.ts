import type { TenantContext, DocumentId } from '@/lib/types';
import type { IngestionJob } from '../domain/types';
export interface IngestionService {
  startIngestion(ctx: TenantContext, documentId: DocumentId): Promise<IngestionJob>;
  getJobStatus(ctx: TenantContext, jobId: string): Promise<IngestionJob | null>;
  advanceStep(ctx: TenantContext, jobId: string): Promise<IngestionJob>;
  failJob(ctx: TenantContext, jobId: string, error: string): Promise<IngestionJob>;
}
