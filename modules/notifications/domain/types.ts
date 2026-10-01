import type { BusinessId, UserId } from '@/lib/types';
export interface Notification {
  readonly id: string; readonly businessId: BusinessId; readonly userId: UserId; readonly type: NotificationType;
  readonly title: string; readonly message: string; readonly severity: NotificationSeverity; readonly status: NotificationStatus;
  readonly actionUrl?: string; readonly metadata?: Record<string, unknown>; readonly createdAt: Date; readonly readAt?: Date;
}
export type NotificationType = 'profit_leak_detected' | 'cash_flow_risk' | 'action_proposed' | 'action_completed' | 'document_processed' | 'low_stock_alert' | 'overdue_payment' | 'review_required' | 'system';
export type NotificationSeverity = 'critical' | 'warning' | 'info' | 'success';
export type NotificationStatus = 'unread' | 'read' | 'dismissed';
