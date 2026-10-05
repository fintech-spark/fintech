// Merchant Brain: extraction file validation
//
// Every uploaded byte is untrusted. This module decides whether a buffer is an
// acceptable extraction input BEFORE it reaches storage, the database, or an AI
// provider.
//
// Design notes
// ------------
// * Detection is by MAGIC BYTES, not by the declared MIME type or the filename.
//   A caller can set `Content-Type: image/png` on an arbitrary file; the leading
//   bytes are the only trustworthy signal.
// * Declared MIME and extension are checked for CONSISTENCY with the sniffed
//   type. A mismatch is rejected rather than silently trusted, which defeats
//   "double extension" tricks like `invoice.pdf.png`.
// * Text formats are additionally required to decode as valid UTF-8, so binary
//   content masquerading as `text/csv` cannot reach a CSV parser.
// * No AI is involved. Validation is deterministic and free.

import { ValidationError } from '@/lib/errors';
import type { DocumentSourceType } from '../domain/types';

/** Formats this project is prepared to extract from. */
export type ExtractionInputKind = 'pdf' | 'image' | 'text' | 'csv';

export interface SupportedFormat {
  readonly kind: ExtractionInputKind;
  /** Canonical MIME types accepted for this format. */
  readonly mimeTypes: readonly string[];
  readonly extensions: readonly string[];
  /** Whether the multimodal model path should receive the raw bytes. */
  readonly multimodal: boolean;
  readonly maxBytes: number;
}

export const MAX_EXTRACTION_BYTES = 50 * 1024 * 1024; // matches documents bucket limit

/**
 * The supported list is derived from the existing DocumentSourceType union and
 * the storage limit in supabase/config.toml — not invented.
 */
export const SUPPORTED_FORMATS: readonly SupportedFormat[] = [
  {
    kind: 'pdf',
    mimeTypes: ['application/pdf'],
    extensions: ['.pdf'],
    multimodal: true,
    maxBytes: MAX_EXTRACTION_BYTES,
  },
  {
    kind: 'image',
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    extensions: ['.png', '.jpg', '.jpeg', '.webp'],
    multimodal: true,
    maxBytes: 20 * 1024 * 1024,
  },
  {
    kind: 'csv',
    mimeTypes: ['text/csv', 'text/plain', 'application/csv'],
    extensions: ['.csv'],
    multimodal: false,
    maxBytes: 10 * 1024 * 1024,
  },
  {
    kind: 'text',
    mimeTypes: ['text/plain'],
    extensions: ['.txt', '.text'],
    multimodal: false,
    maxBytes: 5 * 1024 * 1024,
  },
];

export interface FileSignature {
  readonly kind: ExtractionInputKind;
  readonly mimeType: string;
}

const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Identifies a buffer by its leading bytes.
 *
 * Returns null when the content matches no supported format — including for
 * executables, archives and scripts, which are rejected rather than inspected.
 */
export function sniffFileSignature(bytes: Buffer): FileSignature | null {
  if (bytes.length < 4) return null;

  if (bytes.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
    return { kind: 'pdf', mimeType: 'application/pdf' };
  }

  if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { kind: 'image', mimeType: 'image/png' };
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { kind: 'image', mimeType: 'image/jpeg' };
  }

  // RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { kind: 'image', mimeType: 'image/webp' };
  }

  // Reject obvious binaries before attempting UTF-8 decoding.
  if (containsControlBytes(bytes)) return null;

  const decoded = decodeUtf8Strict(bytes);
  if (decoded === null) return null;

  // A NUL byte in decoded text indicates a mislabelled binary.
  if (decoded.includes('\x00')) return null;

  const firstLine = decoded.split(/\r?\n/, 1)[0] ?? '';

  // A CSV is text whose first line contains a delimiter. This is a heuristic
  // for classification only — the deterministic parser still validates the rows.
  if (firstLine.includes(',') || firstLine.includes(';') || firstLine.includes('\t')) {
    return { kind: 'csv', mimeType: 'text/csv' };
  }

  return { kind: 'text', mimeType: 'text/plain' };
}

/** True when the buffer holds bytes that never appear in plain text. */
function containsControlBytes(bytes: Buffer): boolean {
  const limit = Math.min(bytes.length, 4096);
  for (let i = 0; i < limit; i += 1) {
    const byte = bytes[i];
    // Tab, LF, CR and FF are legitimate in text formats.
    if (byte === 9 || byte === 10 || byte === 12 || byte === 13) continue;
    if (byte < 32 || byte === 127) return true;
  }
  return false;
}

/** Strict UTF-8 decode; returns null when the bytes are not valid UTF-8. */
function decodeUtf8Strict(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export interface ValidatedFile {
  readonly kind: ExtractionInputKind;
  /** MIME type derived from content, not from the request. */
  readonly detectedMimeType: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly multimodal: boolean;
  readonly format: SupportedFormat;
}

export interface ValidationRequest {
  readonly bytes: Buffer;
  readonly fileName: string;
  /** Declared by the caller. Treated as a hint, never as truth. */
  readonly declaredMimeType?: string;
}

/**
 * Validates an upload for extraction.
 *
 * @throws ValidationError with a caller-safe message. The reason never echoes
 *         file content.
 */
export function validateExtractionInput(request: ValidationRequest): ValidatedFile {
  const { bytes, fileName } = request;

  if (bytes.length === 0) {
    throw new ValidationError('The uploaded file is empty.');
  }

  const safeName = sanitiseFileName(fileName);

  if (bytes.length > MAX_EXTRACTION_BYTES) {
    throw new ValidationError(
      `The file exceeds the ${Math.floor(MAX_EXTRACTION_BYTES / (1024 * 1024))}MB limit.`,
    );
  }

  const signature = sniffFileSignature(bytes);
  if (!signature) {
    throw new ValidationError(
      'Unsupported file content. Allowed formats: PDF, PNG, JPEG, WebP, CSV, plain text.',
    );
  }

  const format = SUPPORTED_FORMATS.find((f) => f.kind === signature.kind);
  if (!format) {
    throw new ValidationError('Unsupported file content.');
  }

  if (bytes.length > format.maxBytes) {
    throw new ValidationError(
      `The file exceeds the ${Math.floor(format.maxBytes / (1024 * 1024))}MB limit for ${signature.kind}.`,
    );
  }

  const extension = extensionOf(safeName);
  const imageExtensions: Record<string, readonly string[]> = {
    'image/png': ['.png'], 'image/jpeg': ['.jpg','.jpeg'], 'image/webp': ['.webp'],
  };

  // Extension must be one the format legitimately uses. This is what stops
  // `payload.pdf.png` and `invoice.png.csv` style confusion.
  if (!(imageExtensions[signature.mimeType] ?? format.extensions).includes(extension)) {
    throw new ValidationError(
      `File extension "${extension || 'none'}" does not match the detected content type.`,
    );
  }

  // A declared MIME that contradicts the sniffed type is a red flag, not noise.
  if (request.declaredMimeType) {
    const declared = request.declaredMimeType.split(';')[0]?.trim().toLowerCase();
    if (declared && declared !== signature.mimeType && !(signature.kind === 'csv' && format.mimeTypes.includes(declared))) {
      throw new ValidationError('Declared content type does not match the file content.');
    }
  }

  return {
    kind: signature.kind,
    detectedMimeType: signature.mimeType,
    fileName: safeName,
    sizeBytes: bytes.length,
    multimodal: format.multimodal,
    format,
  };
}

/**
 * Strips directory components and control characters from a filename.
 *
 * Prevents path traversal (`../../etc/passwd`), null-byte truncation, and
 * homograph-style newline injection into logs or storage keys.
 */
export function sanitiseFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, '').trim();

  if (cleaned.length === 0 || cleaned === '.' || cleaned === '..') {
    throw new ValidationError('Invalid file name.');
  }

  if (cleaned.length > 255) {
    throw new ValidationError('File name is too long.');
  }

  return cleaned;
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return '';
  return fileName.slice(dot).toLowerCase();
}

/**
 * Maps a detected format to the DocumentSourceType the database already
 * constrains. Reuses the existing union rather than extending it.
 */
export function toDocumentSourceType(kind: ExtractionInputKind): DocumentSourceType {
  switch (kind) {
    case 'pdf':
      return 'pdf';
    case 'image':
      return 'image';
    case 'csv':
      return 'csv';
    case 'text':
      return 'text';
  }
}

/**
 * Maps a document's declared source type to the extraction schema family.
 * Only the types the existing AI schemas cover are extractable; anything else
 * is rejected by the caller rather than silently coerced.
 */
export type ExtractionSchemaFamily = 'invoice' | 'expense' | 'order';

export function schemaFamilyForSource(
  sourceType: DocumentSourceType,
): ExtractionSchemaFamily | null {
  switch (sourceType) {
    case 'invoice':
    case 'upi_screenshot':
    case 'image':
    case 'pdf':
      return 'invoice';
    case 'receipt':
      return 'expense';
    case 'whatsapp_export':
    case 'text':
      return 'order';
    default:
      return null;
  }
}
