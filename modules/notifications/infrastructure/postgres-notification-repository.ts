import type { BusinessId, PaginatedResult } from '@/lib/types';
import { asBusinessId, asUserId } from '@/lib/types';
import type {
  Notification,
  NotificationSeverity,
  NotificationStatus,
  NotificationType,
} from '../domain/types';
import type { NotificationFilters } from '../application/service';

interface NotificationSqlRow {
  id: string;
  business_id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  severity: NotificationSeverity;
  status: NotificationStatus;
  action_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
}

function toDomain(row: NotificationSqlRow): Notification {
  return {
    id: row.id,
    businessId: asBusinessId(row.business_id),
    userId: asUserId(row.user_id),
    type: row.type,
    title: row.title,
    message: row.message,
    severity: row.severity,
    status: row.status,
    actionUrl: row.action_url ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: new Date(row.created_at),
    readAt: row.read_at ? new Date(row.read_at) : undefined,
  };
}

export class PostgresNotificationRepository {
  constructor(
    private readonly db: {
      query<T>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>;
      execute(sql: string, params?: readonly unknown[]): Promise<number>;
    },
  ) {}

  async save(notification: Notification): Promise<Notification> {
    await this.db.execute(
      `INSERT INTO notifications (
        id, business_id, user_id, type, title, message, severity, status, action_url, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        notification.id,
        notification.businessId,
        notification.userId,
        notification.type,
        notification.title,
        notification.message,
        notification.severity,
        notification.status,
        notification.actionUrl ?? null,
        JSON.stringify(notification.metadata ?? {}),
        notification.createdAt.toISOString(),
      ],
    );
    return notification;
  }

  async list(
    businessId: BusinessId,
    filters: NotificationFilters,
  ): Promise<PaginatedResult<Notification>> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['business_id = $1'];
    const params: unknown[] = [businessId];

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }

    if (filters.type) {
      params.push(filters.type);
      conditions.push(`type = $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const countRows = await this.db.query<{ count: string }>(
      `SELECT count(*)::text as count FROM notifications WHERE ${where}`,
      params,
    );
    const total = parseInt(countRows[0]?.count ?? '0', 10);

    const queryParams = [...params, limit, offset];
    const rows = await this.db.query<NotificationSqlRow>(
      `SELECT id, business_id, user_id, type, title, message, severity, status, action_url, metadata, created_at, read_at
       FROM notifications
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
      queryParams,
    );

    return {
      items: rows.map(toDomain),
      total,
      page,
      limit,
      hasMore: offset + rows.length < total,
    };
  }

  async markAsRead(businessId: BusinessId, notificationId: string): Promise<void> {
    await this.db.execute(
      `UPDATE notifications
       SET status = 'read', read_at = now(), updated_at = now()
       WHERE business_id = $1 AND id = $2 AND status = 'unread'`,
      [businessId, notificationId],
    );
  }

  async markAllAsRead(businessId: BusinessId): Promise<void> {
    await this.db.execute(
      `UPDATE notifications
       SET status = 'read', read_at = now(), updated_at = now()
       WHERE business_id = $1 AND status = 'unread'`,
      [businessId],
    );
  }

  async getUnreadCount(businessId: BusinessId): Promise<number> {
    const rows = await this.db.query<{ count: string }>(
      `SELECT count(*)::text as count FROM notifications WHERE business_id = $1 AND status = 'unread'`,
      [businessId],
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }
}
