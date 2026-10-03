// Merchant Brain: minimal evidence service interface (stub)
// Phase 6 architecture-consistent gap: evidence/provenance contract.
// Actual persistence is deferred to business-brain / audit layer; this
// interface defines the contract so downstream AI modules can reference it.

import type {
  EvidenceEnvelope,
  EvidenceConflict,
} from '../domain/types';

export interface EvidenceService {
  createEnvelope(
    params: Partial<EvidenceEnvelope> &
      Pick<EvidenceEnvelope, 'claim' | 'claimType'>,
  ): Promise<Partial<EvidenceEnvelope>>;

  verifyEnvelope(envelope: EvidenceEnvelope): {
    valid: boolean;
    missingFields: string[];
    conflicts: string[];
  };

  recordConflict(
    envelope: Partial<EvidenceEnvelope>,
    conflict: EvidenceConflict,
  ): Promise<{ envelopeId: string; conflictRecorded: boolean } | null>;
}

// Minimal synthetic stub for architecture wiring and synthetic evaluation.
// Does NOT interact with provider/model; safe without .env API keys.
export class SyntheticEvidenceService implements EvidenceService {
  async createEnvelope(
    params: Partial<EvidenceEnvelope> & Pick<EvidenceEnvelope, 'claim' | 'claimType'>,
  ): Promise<Partial<EvidenceEnvelope>> {
    return {
      ...params,
      evidence: params.evidence ?? 'synthetic-stub',
      sourceIds: params.sourceIds ?? ['synthetic-source-id'],
      affectedRecords: params.affectedRecords ?? [{ recordId: 'stub-record', tenantScope: 'stub-tenant' }],
      impact: params.impact ?? { value: 0, qualitative: 'stub-impact' },
      explanation: params.explanation ?? 'stub-explanation',
      confidence: params.confidence ?? { label: 'unverified' },
      freshness: params.freshness ?? { sourceTimestamp: new Date().toISOString(), lastVerified: new Date().toISOString() },
      policyMetadata: params.policyMetadata ?? {
        promptVersion: 'stub-v0',
        modelRole: 'stub',
        schemaVersion: 'stub-v0',
        reviewStatus: 'unverified',
      },
    };
  }

  verifyEnvelope(envelope: EvidenceEnvelope): {
    valid: boolean;
    missingFields: string[];
    conflicts: string[];
  } {
    const missing: string[] = [];
    if (!envelope.claim) missing.push('claim');
    if (!envelope.claimType) missing.push('claimType');
    if (!envelope.sourceIds || envelope.sourceIds.length === 0) missing.push('sourceIds');
    if (!envelope.policyMetadata) missing.push('policyMetadata');

    const conflictNotes: string[] = (envelope.conflicts ?? [])
      .filter((c: EvidenceConflict) => c.resolutionStatus === 'unresolved')
      .map((c: EvidenceConflict) => `conflict:${c.recordId}`);

    return {
      valid: missing.length === 0 && conflictNotes.length === 0,
      missingFields: missing,
      conflicts: conflictNotes,
    };
  }

  async recordConflict(
    envelope: Partial<EvidenceEnvelope>,
    conflict: EvidenceConflict,
  ): Promise<{ envelopeId: string; conflictRecorded: boolean } | null> {
    return { envelopeId: conflict?.recordId ?? 'stub-conflict-id', conflictRecorded: true };
  }
}
