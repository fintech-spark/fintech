export type { Document, DocumentSourceType, DocumentStatus, DocumentMetadata } from './domain/types';
export { canTransitionDocumentTo, canRetry, needsReview, isFinalized, isAllowedMimeType, isWithinSizeLimit, isOwnTenantStoragePath, storageTenantPrefix, ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from './domain/rules';
export type { DocumentService, UploadDocumentInput, DocumentFilters } from './application/service';
export type { DocumentRepository, StorageAdapter } from './infrastructure/repository';
export { validateExtractionInput, sniffFileSignature, sanitiseFileName, toDocumentSourceType,
  schemaFamilyForSource, MAX_EXTRACTION_BYTES, SUPPORTED_FORMATS } from './infrastructure/file-validation';
export type { ValidatedFile, ValidationRequest, SupportedFormat, FileSignature,
  ExtractionInputKind, ExtractionSchemaFamily } from './infrastructure/file-validation';
export type { DocumentReviewInput } from './domain/review';
