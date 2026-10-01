import type { BusinessId, DocumentId } from '@/lib/types';
export interface ExtractionResult {
  readonly id: string; readonly businessId: BusinessId; readonly documentId: DocumentId; readonly status: ExtractionStatus;
  readonly fields: readonly ExtractionField[]; readonly overallConfidence: ConfidenceLevel; readonly modelUsed: string;
  readonly rawOutput?: string; readonly extractedAt: Date; readonly validatedAt?: Date;
}
export type ExtractionStatus = 'pending' | 'processing' | 'completed' | 'validated' | 'rejected' | 'failed';
export interface ExtractionField { readonly name: string; readonly value: unknown; readonly type: FieldType; readonly confidence: ConfidenceLevel; readonly source?: string; }
export type FieldType = 'string' | 'number' | 'date' | 'money' | 'boolean' | 'array';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export const CONFIDENCE_THRESHOLDS = { high: 0.9, medium: 0.7, low: 0.0 } as const;
export function classifyConfidence(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_THRESHOLDS.high) return 'high';
  if (score >= CONFIDENCE_THRESHOLDS.medium) return 'medium';
  return 'low';
}
