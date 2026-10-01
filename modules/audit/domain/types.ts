import type { BusinessId, UserId } from '@/lib/types';
export interface AuditEntry {
  readonly id: string; readonly businessId: BusinessId; readonly userId: UserId; readonly action: AuditAction;
  readonly resourceType: AuditResourceType; readonly resourceId: string; readonly before?: Record<string, unknown>;
  readonly after?: Record<string, unknown>; readonly metadata?: Record<string, unknown>; readonly ip?: string;
  readonly userAgent?: string; readonly timestamp: Date;
}
export type AuditAction = 'create' | 'update' | 'delete' | 'approve' | 'reject' | 'execute' | 'upload' | 'extract' | 'login' | 'view';
export type AuditResourceType = 'transaction' | 'expense' | 'product' | 'customer' | 'supplier' | 'document' | 'action' | 'scenario' | 'business_setting' | 'user' | 'brain_query';
