// Shared file validation is owned by documents (extraction depends on documents).
export { validateExtractionInput, sniffFileSignature, sanitiseFileName, toDocumentSourceType,
  schemaFamilyForSource, MAX_EXTRACTION_BYTES, SUPPORTED_FORMATS } from '@/modules/documents';
export type { ValidatedFile, ValidationRequest, SupportedFormat, FileSignature,
  ExtractionInputKind, ExtractionSchemaFamily } from '@/modules/documents';
