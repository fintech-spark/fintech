import { randomUUID } from 'node:crypto';
import type { PaginatedResult, TenantContext } from '@/lib/types';
import type {
  Notification,
} from '../domain/types';
import type {
  NotificationFilters,
  NotificationService,
  SendNotificationInput,
} from './service';
import type { PostgresNotificationRepository } from '../infrastructure/postgres-notification-repository';

export class PostgresNotificationService implements NotificationService {
  constructor(private readonly repository: PostgresNotificationRepository) {}

  async send(ctx: TenantContext, input: SendNotificationInput): Promise<Notification> {
    const notification: Notification = {
      id: randomUUID(),
      businessId: ctx.businessId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      severity: input.severity,
      status: 'unread',
      actionUrl: input.actionUrl,
      metadata: input.metadata,
      createdAt: new Date(),
    };
    return this.repository.save(notification);
  }

  async list(
    ctx: TenantContext,
    filters: NotificationFilters,
  ): Promise<PaginatedResult<Notification>> {
    return this.repository.list(ctx.businessId, filters);
  }

  async markAsRead(ctx: TenantContext, notificationId: string): Promise<void> {
    await this.repository.markAsRead(ctx.businessId, notificationId);
  }

  async markAllAsRead(ctx: TenantContext): Promise<void> {
    await this.repository.markAllAsRead(ctx.businessId);
  }

  async getUnreadCount(ctx: TenantContext): Promise<number> {
    return this.repository.getUnreadCount(ctx.businessId);
  }
}
