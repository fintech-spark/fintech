import type { TenantContext, PaginatedResult, PaginationParams, UserId } from '@/lib/types';
import type { Notification, NotificationType, NotificationSeverity, NotificationStatus } from '../domain/types';
export interface NotificationService {
  send(ctx: TenantContext, input: SendNotificationInput): Promise<Notification>;
  list(ctx: TenantContext, filters: NotificationFilters): Promise<PaginatedResult<Notification>>;
  markAsRead(ctx: TenantContext, notificationId: string): Promise<void>;
  markAllAsRead(ctx: TenantContext): Promise<void>;
  getUnreadCount(ctx: TenantContext): Promise<number>;
}
export interface SendNotificationInput { readonly userId: UserId; readonly type: NotificationType; readonly title: string; readonly message: string; readonly severity: NotificationSeverity; readonly actionUrl?: string; readonly metadata?: Record<string, unknown>; }
export interface NotificationFilters extends PaginationParams { readonly type?: NotificationType; readonly status?: NotificationStatus; }
