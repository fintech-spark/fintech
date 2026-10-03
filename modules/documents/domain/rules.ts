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

/**
 * Storage object names follow `<business_id>/<user_id>/<file_uuid>-<name>`
 * (migration 0005). Returns the leading tenant segment, or null when the path
 * is structurally unusable as a tenant-scoped object name.
 */
export function storageTenantPrefix(storagePath: string): string | null {
  if (typeof storagePath !== 'string' || storagePath.length === 0) return null;
  const slash = storagePath.indexOf('/');
  if (slash <= 0) return null;
  const first = storagePath.slice(0, slash);
  if (first === '.' || first === '..') return null;
  return first;
}

/**
 * True only when the path is addressed to exactly `businessId`.
 *
 * Comparison is on the whole leading segment, not a string prefix: a caller in
 * `abc-123` must not pass `abc-1234/secret.pdf`, which a bare `startsWith`
 * would accept. Backslashes are rejected outright so no consumer can later
 * re-split the name on a Windows separator and re-derive a different prefix.
 */
export function isOwnTenantStoragePath(storagePath: string, businessId: string): boolean {
  if (typeof storagePath !== 'string' || storagePath.length === 0) return false;
  if (storagePath.includes('\\')) return false;
  return storageTenantPrefix(storagePath) === businessId;
}
