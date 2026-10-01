import type { LeakSeverity } from './types';
export function classifySeverity(monthlyImpactMinorUnits: number): LeakSeverity {
  if (monthlyImpactMinorUnits >= 50_000_00) return 'critical';
  if (monthlyImpactMinorUnits >= 10_000_00) return 'high';
  if (monthlyImpactMinorUnits >= 2_000_00) return 'medium';
  return 'low';
}
export function hasMinimumEvidence(evidenceCount: number, category: string): boolean {
  const highEvidenceCategories = ['margin_compression', 'abnormal_expenses'];
  const minRequired = highEvidenceCategories.includes(category) ? 3 : 1;
  return evidenceCount >= minRequired;
}
