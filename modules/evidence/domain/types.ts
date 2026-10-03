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
  readonly claim: string;
  readonly claimType: ClaimType;
  readonly evidence: string;
  readonly sourceIds: readonly string[];
  readonly affectedRecords: readonly EvidenceRecord[];
  readonly impact: EvidenceImpact;
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
