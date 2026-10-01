import type { BusinessId, DocumentId, UserId } from '@/lib/types';
export interface IngestionJob {
  readonly id: string; readonly businessId: BusinessId; readonly documentId: DocumentId; readonly state: ProcessingState;
  readonly sourceType: string; readonly steps: readonly IngestionStep[]; readonly result?: IngestionResult; readonly error?: string;
  readonly startedAt: Date; readonly completedAt?: Date; readonly createdBy: UserId;
}
export type ProcessingState = 'pending' | 'validating' | 'storing' | 'extracting' | 'normalizing' | 'deduplicating' | 'review' | 'approved' | 'completed' | 'failed';
export interface IngestionStep { readonly name: string; readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'; readonly startedAt?: Date; readonly completedAt?: Date; readonly error?: string; }
export interface IngestionResult { readonly extractedEntities: number; readonly duplicatesFound: number; readonly requiresReview: boolean; readonly reviewReasons?: readonly string[]; }
