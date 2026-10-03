// Evidence/provenance contract exported for AI modules, business-brain,
// audit, and downstream consumers. Matches docs/ai/AI_EVIDENCE_RULES.md.
export type { EvidenceEnvelope, EvidenceRecord, EvidenceConflict, EvidenceImpact, EvidenceConfidence, ClaimType } from './domain/types';
export type { EvidenceService } from './application/evidence-service';
export { SyntheticEvidenceService } from './application/evidence-service';
