// Synthetic evidence envelope test (no provider/model required)
// Verifies the architecture-consistent gap for Phase 6 evidence/provenance.

import { describe, expect, it } from 'vitest';
import { SyntheticEvidenceService } from '../../modules/evidence/application/evidence-service';

describe('Evidence envelope — synthetic stub', () => {
  const service = new SyntheticEvidenceService();

  it('creates a stub envelope meeting AI_EVIDENCE_RULES.md contract', async () => {
    const result = await service.createEnvelope({
      claim: 'Synthetic revenue observation for architecture verification',
      claimType: 'interpretation',
    });

    expect(result.claim).toBe('Synthetic revenue observation for architecture verification');
    expect(result.claimType).toBe('interpretation');
    expect(result.sourceIds).toHaveLength(1);
    expect(result.confidence).toBeDefined();
    expect(result.policyMetadata).toBeDefined();
    expect(result.policyMetadata?.reviewStatus).toBe('unverified');
  });

  it('verifies a complete envelope as valid', () => {
    const envelope = {
      claim: 'stub',
      claimType: 'fact' as const,
      evidence: 'stub-evidence',
      sourceIds: ['stub-source'],
      affectedRecords: [{ recordId: 'stub', tenantScope: 'stub-tenant' }],
      impact: { value: 100, unit: 'unit', period: 'month' },
      explanation: 'stub',
      confidence: { label: 'high' as const },
      freshness: { sourceTimestamp: new Date().toISOString(), lastVerified: new Date().toISOString() },
      conflicts: [],
      policyMetadata: {
        promptVersion: 'stub-v0',
        modelRole: 'stub',
        schemaVersion: 'stub-v0',
        reviewStatus: 'verified' as const,
      },
    };

    const check = service.verifyEnvelope(envelope);
    expect(check.valid).toBe(true);
    expect(check.missingFields).toHaveLength(0);
    expect(check.conflicts).toHaveLength(0);
  });

  it('detects unresolved conflicts', () => {
    const envelope = {
      claim: 'stub',
      claimType: 'fact' as const,
      evidence: 'stub',
      sourceIds: ['stub'],
      affectedRecords: [{ recordId: 'stub', tenantScope: 'stub' }],
      impact: { value: 0 },
      explanation: 'stub',
      confidence: { label: 'unverified' as const },
      freshness: { sourceTimestamp: 'now', lastVerified: 'now' },
      conflicts: [{ recordId: 'c1', description: 'stub', resolutionStatus: 'unresolved' as const }],
      policyMetadata: {
        promptVersion: 'v',
        modelRole: 'm',
        schemaVersion: 'v',
        reviewStatus: 'unverified' as const,
      },
    };

    const check = service.verifyEnvelope(envelope);
    expect(check.valid).toBe(false);
    expect(check.conflicts.length).toBeGreaterThan(0);
  });
});
