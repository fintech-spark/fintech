import type { BusinessId, DocumentId, UserId } from '@/lib/types';
export interface Document {
  readonly id: DocumentId; readonly businessId: BusinessId; readonly sourceType: DocumentSourceType; readonly fileName: string;
  readonly mimeType: string; readonly fileSize: number; readonly storagePath: string; readonly status: DocumentStatus;
  readonly metadata: DocumentMetadata; readonly uploadedAt: Date; readonly processedAt?: Date; readonly uploadedBy: UserId;
}
export type DocumentSourceType = 'invoice' | 'receipt' | 'upi_screenshot' | 'pdf' | 'audio' | 'csv' | 'excel' | 'whatsapp_export' | 'text' | 'image' | 'other';
export type DocumentStatus = 'uploaded' | 'validating' | 'queued' | 'processing' | 'extracted' | 'review_required' | 'approved' | 'rejected' | 'failed';
export interface DocumentMetadata { readonly originalName: string; readonly contentHash?: string; readonly pageCount?: number; readonly language?: string; readonly extractionId?: string; readonly rejectionReason?: string; readonly tags?: readonly string[]; }
export const DOCUMENT_STATUS_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  uploaded: ['validating', 'failed'], validating: ['queued', 'failed'], queued: ['processing'],
  processing: ['extracted', 'failed'], extracted: ['review_required', 'approved'], review_required: ['approved', 'rejected'],
  approved: [], rejected: [], failed: ['queued'],
};
