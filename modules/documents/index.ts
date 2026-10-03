export type { Document, DocumentSourceType, DocumentStatus, DocumentMetadata } from './domain/types';
export { canTransitionDocumentTo, canRetry, needsReview, isFinalized, isAllowedMimeType, isWithinSizeLimit, isOwnTenantStoragePath, storageTenantPrefix, ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from './domain/rules';
export type { DocumentService, UploadDocumentInput, DocumentFilters } from './application/service';
export type { DocumentRepository, StorageAdapter } from './infrastructure/repository';
