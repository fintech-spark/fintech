export type { Notification, NotificationType, NotificationSeverity, NotificationStatus } from './domain/types';
export type { NotificationService, SendNotificationInput, NotificationFilters } from './application/service';

export {
  ALERT_DEDUPE_WINDOW_MS,
  alertDedupeKey,
  formatMinorUnits,
  humaniseCategory,
  InMemoryAlertDedupeStore,
  severityForLeak,
  severityForRisk,
  subscribeIntelligenceAlerts,
  type AlertDedupeStore,
  type AlertRecipientResolver,
  type AlertSink,
  type IntelligenceAlert,
  type IntelligenceAlertKind,
} from './application/intelligence-alerts';

export { PostgresNotificationRepository } from './infrastructure/postgres-notification-repository';
export { PostgresNotificationService } from './application/postgres-notification-service';
