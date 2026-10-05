// Merchant Brain: Evidence claim envelope types
// Matches docs/ai/AI_EVIDENCE_RULES.md claim envelope (lines 7-19).

export type ClaimType =
  | 'fact'
  | 'deterministic_calculation'
  | 'interpretation'
  | 'recommendation'
  | 'draft';

export interface EvidenceRecord {
  readonly recordId: string;
  readonly tenantScope: string;
}

export interface EvidenceConflict {
  readonly recordId: string;
  readonly description: string;
  readonly resolutionStatus: 'unresolved' | 'resolved' | 'rejected';
}

export interface EvidenceImpact {
  readonly value: number | string;
  readonly unit?: string;
  readonly period?: string;
  readonly range?: { readonly min: number; readonly max: number };
  readonly qualitative?: string;
}

export interface EvidenceConfidence {
  readonly label: 'high' | 'medium' | 'low' | 'unverified';
  readonly calibratedScore?: number;
  readonly note?: string;
}

export interface EvidenceEnvelope {
  readonly id: string;
  readonly businessId: string;
  readonly userId: string;
  readonly claim: string;
  readonly claimType: ClaimType;
  readonly evidence: string;
  readonly sourceIds: readonly string[];
  readonly affectedRecords: readonly EvidenceRecord[];
  readonly impact?: EvidenceImpact;
  readonly explanation: string;
  readonly confidence: EvidenceConfidence;
  readonly freshness: {
    readonly sourceTimestamp: string;
    readonly lastVerified: string;
  };
  readonly conflicts?: readonly EvidenceConflict[];
  readonly policyMetadata: {
    readonly promptVersion: string;
    readonly modelRole: string;
    readonly schemaVersion: string;
    readonly reviewStatus: 'unverified' | 'needs_review' | 'verified' | 'rejected' | 'stale';
  };
}

/** A query snapshot or a recorded document chunk, never a model-created source. */
export interface EvidenceSource {
  readonly id: string;
  readonly businessId: string;
  readonly userId: string;
  readonly resourceId: string;
  readonly kind: 'tool_fact' | 'deterministic_metric' | 'retrieved_document';
  readonly content: string;
  readonly observedAt: string;
  readonly origin: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly documentId?: string;
  readonly chunkId?: string;
}

export type EvidenceResult =
  | { readonly status: 'verified'; readonly envelope: EvidenceEnvelope }
  | { readonly status: 'insufficient_evidence'; readonly missingSourceIds: readonly string[] };
