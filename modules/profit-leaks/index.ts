export type { ProfitLeak, LeakCategory, LeakSeverity, LeakStatus, LeakEvidence, EvidenceType } from './domain/types';
export { classifySeverity, hasMinimumEvidence } from './domain/rules';
export type { ProfitLeakService, LeakFilters } from './application/service';
export type { ProfitLeakRepository } from './infrastructure/repository';
