import type { BusinessId, DocumentId, PaginatedResult } from '@/lib/types';
import type { Document } from '../domain/types';
import type { DocumentFilters } from '../application/service';
export interface DocumentRepository {
  findById(businessId: BusinessId, id: DocumentId): Promise<Document | null>;
  save(document: Document): Promise<Document>;
  update(document: Document): Promise<Document>;
  list(businessId: BusinessId, filters: DocumentFilters): Promise<PaginatedResult<Document>>;
  findByContentHash(businessId: BusinessId, contentHash: string): Promise<Document | null>;
}
export interface StorageAdapter {
  upload(path: string, data: Buffer | ArrayBuffer, mimeType: string): Promise<string>;
  download(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  getUrl(path: string): Promise<string>;
}
