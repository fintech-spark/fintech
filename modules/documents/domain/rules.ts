import type { DocumentStatus } from './types';
import { DOCUMENT_STATUS_TRANSITIONS } from './types';
export function canTransitionDocumentTo(current: DocumentStatus, next: DocumentStatus): boolean { return DOCUMENT_STATUS_TRANSITIONS[current].includes(next); }
export function canRetry(status: DocumentStatus): boolean { return status === 'failed'; }
export function needsReview(status: DocumentStatus): boolean { return status === 'review_required'; }
export function isFinalized(status: DocumentStatus): boolean { return status === 'approved' || status === 'rejected'; }
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'audio/mpeg', 'audio/wav', 'audio/webm', 'text/plain'] as const;
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export function isAllowedMimeType(mimeType: string): boolean { return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType); }
export function isWithinSizeLimit(sizeBytes: number): boolean { return sizeBytes <= MAX_FILE_SIZE_BYTES; }
