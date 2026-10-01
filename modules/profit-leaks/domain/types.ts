import type { BusinessId, Money } from '@/lib/types';
export interface ProfitLeak {
  readonly id: string; readonly businessId: BusinessId; readonly category: LeakCategory; readonly severity: LeakSeverity;
  readonly title: string; readonly description: string; readonly impact: Money; readonly impactPeriod: string;
  readonly evidence: readonly LeakEvidence[]; readonly status: LeakStatus; readonly detectedAt: Date; readonly resolvedAt?: Date;
}
export type LeakCategory = 'supplier_cost_increase' | 'margin_compression' | 'excessive_discounting' | 'dead_inventory' | 'high_payment_fees' | 'abnormal_expenses' | 'overdue_receivables' | 'low_margin_products';
export type LeakSeverity = 'critical' | 'high' | 'medium' | 'low';
export type LeakStatus = 'active' | 'acknowledged' | 'resolved' | 'dismissed';
export interface LeakEvidence { readonly type: EvidenceType; readonly resourceId: string; readonly description: string; readonly value?: number; }
export type EvidenceType = 'transaction' | 'expense' | 'product' | 'supplier' | 'customer' | 'invoice' | 'calculation';
