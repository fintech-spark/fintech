import type { BusinessId, DocumentId } from '@/lib/types';
import type { ConfidenceLevel } from '../../extraction/domain/types';

// Validation result extending existing ExtractionResult, not duplicating.
// The validation stage determines whether extraction is trusted enough to
// become authoritative, without writing to authoritative tables directly.
export interface ValidationResult {
  readonly extractionId: string;
  readonly documentId: DocumentId;
  readonly businessId: BusinessId;
  readonly status: 'VALIDATED' | 'NEEDS_REVIEW' | 'REJECTED' | 'UNSUPPORTED' | 'FAILED';
  readonly validatorType: 'deterministic' | 'ai' | 'mixed';
  readonly validatedAt: Date;
  readonly evidence: readonly EvidenceItem[];
  readonly confidence: ConfidenceLevel;
  readonly reason?: string; // why NEEDS_REVIEW / REJECTED
  readonly contradictions?: readonly string[]; // cross-field conflicts
  readonly missingEvidence?: readonly string[]; // required fields without source
}

export interface EvidenceItem {
  readonly sourceType: 'invoice' | 'receipt' | 'expense' | 'transaction' | 'document';
  readonly sourceId: string; // DocumentId or record ID
  readonly recordId?: string; // authorized business record if cross-checked
  readonly field: string; // extracted field name
  readonly excerpt?: string; // exact source fragment — never fabricated
  readonly observedAt?: string; // source document timestamp
  readonly support: 'DIRECTLY_SUPPORTED' | 'DERIVED' | 'INFERRED' | 'UNSUPPORTED' | 'CONFLICTING' | 'PARTIAL' | 'STALE';
}
