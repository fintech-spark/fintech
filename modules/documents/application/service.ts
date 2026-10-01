import type { TenantContext, PaginatedResult, PaginationParams, DocumentId, DateRange } from '@/lib/types';
import type { Document, DocumentSourceType, DocumentStatus } from '../domain/types';
export interface DocumentService {
  upload(ctx: TenantContext, input: UploadDocumentInput): Promise<Document>;
  getById(ctx: TenantContext, id: DocumentId): Promise<Document | null>;
  list(ctx: TenantContext, filters: DocumentFilters): Promise<PaginatedResult<Document>>;
  updateStatus(ctx: TenantContext, id: DocumentId, status: DocumentStatus, reason?: string): Promise<Document>;
  approve(ctx: TenantContext, id: DocumentId): Promise<Document>;
  reject(ctx: TenantContext, id: DocumentId, reason: string): Promise<Document>;
}
export interface UploadDocumentInput { readonly fileName: string; readonly mimeType: string; readonly fileSize: number; readonly sourceType: DocumentSourceType; readonly fileData: Buffer | ArrayBuffer; readonly tags?: readonly string[]; }
export interface DocumentFilters extends PaginationParams { readonly status?: DocumentStatus; readonly sourceType?: DocumentSourceType; readonly dateRange?: DateRange; readonly search?: string; }
