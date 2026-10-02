import { createHash } from 'node:crypto';
import type { BusinessId, UserId } from '@/lib/types';
import type { EventBus } from '@/lib/events';

/**
 * Notification delivery for intelligence findings.
 *
 * This module declares no sibling-module dependencies (`MODULE_DEPENDENCIES`
 * gives `notifications: []`), so it reaches the intelligence layer only through
 * the shared event bus. Profit leaks, cash-flow risks and action outcomes publish
 * typed events; this file subscribes and turns them into merchant-facing alerts.
 * Neither side imports the other.
 *
 * Two rules shape everything here:
 *
 *  * NO UNSUPPORTED CLAIM. Every notification is built from a verified figure in
 *    the event payload. Nothing is inferred, estimated or rounded up for effect.
 *  * NO ALERT SPAM. Every alert carries a deterministic dedupe key. Re-delivery of
 *    the same event, or a rescan producing the same finding, produces no second
 *    alert.
 */

export type IntelligenceAlertKind =
  | 'profit_leak'
  | 'cash_flow_risk'
  | 'action_proposed'
  | 'action_approved'
  | 'action_completed';

/** Everything needed to persist one alert. */
export interface IntelligenceAlert {
  readonly businessId: BusinessId;
  readonly userId: UserId;
  readonly type:
    | 'profit_leak_detected'
    | 'cash_flow_risk'
    | 'action_proposed'
    | 'action_completed';
  readonly title: string;
  readonly message: string;
  readonly severity: 'critical' | 'warning' | 'info' | 'success';
  /** In-app destination for the alert. Never an absolute or external URL. */
  readonly actionUrl: string;
  /** Stable reference back to the source finding. */
  readonly referenceId: string;
  readonly dedupeKey: string;
  readonly occurredAt: Date;
}

/**
 * Where an alert is delivered.
 *
 * A port rather than a direct dependency, so the notifications module stays free
 * of module-to-module imports and the composition root chooses the transport.
 */
export interface AlertSink {
  /**
   * Persist one alert. Implementations must be idempotent on `dedupeKey`:
   * a repeated delivery returns the existing alert rather than creating a second.
   */
  deliver(alert: IntelligenceAlert): Promise<void>;
}

/** Supplies the users who should receive a class of alert. */
export interface AlertRecipientResolver {
  /**
   * Users who own or administer the business.
   *
   * Resolution is injected because reading `business_members` belongs to the
   * businesses/auth modules, which this module may not import.
   */
  resolveRecipients(businessId: BusinessId, kind: IntelligenceAlertKind): Promise<readonly UserId[]>;
}

/** How long an identical alert stays suppressed. */
export const ALERT_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * In-memory dedupe guard.
 *
 * Keeps the last `dedupeKey` per business for the suppression window. Backed by a
 * store in production; the interface is deliberately tiny so a shared cache can be
 * substituted without changing the subscriber.
 */
export interface AlertDedupeStore {
  /** True when this key was already seen inside the window. */
  wasSeen(businessId: BusinessId, dedupeKey: string, now: Date): boolean;
  remember(businessId: BusinessId, dedupeKey: string, now: Date): void;
}

/** Simple process-local implementation, adequate for a single deployable unit. */
export class InMemoryAlertDedupeStore implements AlertDedupeStore {
  private readonly seen = new Map<string, number>();

  wasSeen(businessId: BusinessId, dedupeKey: string, now: Date): boolean {
    const key = `${businessId}:${dedupeKey}`;
    const at = this.seen.get(key);
    if (at === undefined) return false;
    if (now.getTime() - at > ALERT_DEDUPE_WINDOW_MS) {
      this.seen.delete(key);
      return false;
    }
    return true;
  }

  remember(businessId: BusinessId, dedupeKey: string, now: Date): void {
    this.seen.set(`${businessId}:${dedupeKey}`, now.getTime());
  }
}

/**
 * Stable dedupe key for a finding.
 *
 * Uses `node:crypto` directly rather than a shared helper: `MODULE_DEPENDENCIES`
 * declares `notifications: []`, so importing one would be a forbidden sibling
 * dependency. SHA-256 truncated to 16 hex characters is more than enough to keep
 * one merchant's alert volume from colliding, and it is available with no
 * dependency at all.
 */
export function alertDedupeKey(
  businessId: BusinessId,
  kind: IntelligenceAlertKind,
  referenceId: string,
): string {
  return createHash('sha256')
    .update([kind, referenceId].join('\u001f'))
    .digest('hex')
    .slice(0, 16);
}

/** Maps a verified leak severity onto a notification severity. */
export function severityForLeak(severity: string): IntelligenceAlert['severity'] {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'high':
    case 'medium':
      return 'warning';
    default:
      return 'info';
  }
}

/** Maps a cash-flow risk severity onto a notification severity. */
export function severityForRisk(severity: string): IntelligenceAlert['severity'] {
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'warning';
  return 'info';
}

/**
 * Registers every intelligence subscriber on the event bus.
 *
 * Returns a function that removes all of them, so a test or a hot reload can
 * unsubscribe cleanly and cannot leave a double-registration behind.
 *
 * Handlers are defensive about payload shape: an event whose fields do not match
 * the declared type is ignored rather than throwing, because a malformed event
 * must not break the publish that produced it.
 */
export function subscribeIntelligenceAlerts(input: {
  bus: EventBus;
  sink: AlertSink;
  recipients: AlertRecipientResolver;
  dedupe?: AlertDedupeStore;
  now: () => Date;
}): () => void {
  const dedupe = input.dedupe ?? new InMemoryAlertDedupeStore();

  const unsubscribeLeak = input.bus.subscribe('profit_leak.detected', (event) => {
    const amount = event.payload.estimatedLossMinorUnits;
    const category = event.payload.category;
    if (typeof amount !== 'number' || typeof category !== 'string') return;
    void deliver(input, dedupe, {
      kind: 'profit_leak',
      businessId: event.businessId,
      referenceId: String(event.payload.leakId),
      title: `Profit leak detected: ${humaniseCategory(category)}`,
      message:
        `A ${event.payload.severity} profit leak was detected in ${humaniseCategory(category)}. ` +
        `Estimated impact ${formatMinorUnits(amount)} per month.`,
      severity: severityForLeak(event.payload.severity),
      actionUrl: `/profit-leaks/${encodeURIComponent(String(event.payload.leakId))}`,
      occurredAt: event.timestamp,
    });
  });

  const unsubscribeRisk = input.bus.subscribe('cash_flow.risk_detected', (event) => {
    const shortfall = event.payload.projectedShortfallMinorUnits;
    if (typeof shortfall !== 'number') return;
    const projectedDate = event.payload.projectedDate;
    void deliver(input, dedupe, {
      kind: 'cash_flow_risk',
      businessId: event.businessId,
      referenceId: `${String(event.payload.riskType)}:${isoDay(projectedDate)}`,
      title: `Cash-flow risk: ${humaniseRiskType(String(event.payload.riskType))}`,
      message:
        `A projected shortfall of ${formatMinorUnits(shortfall)} is expected on ` +
        `${isoDay(projectedDate)}.`,
      severity: 'critical',
      actionUrl: '/cash-flow',
      occurredAt: event.timestamp,
    });
  });

  const unsubscribeProposed = input.bus.subscribe('action.proposed', (event) => {
    void deliver(input, dedupe, {
      kind: 'action_proposed',
      businessId: event.businessId,
      referenceId: String(event.payload.actionId),
      title: 'An action is waiting for your approval',
      message:
        `An action of type "${humaniseActionType(String(event.payload.type))}" was proposed ` +
        `from ${humaniseSource(String(event.payload.source))}. It will not run without your approval.`,
      severity: 'info',
      actionUrl: `/actions/${encodeURIComponent(String(event.payload.actionId))}`,
      occurredAt: event.timestamp,
    });
  });

  const unsubscribeApproved = input.bus.subscribe('action.approved', (event) => {
    void deliver(input, dedupe, {
      kind: 'action_approved',
      businessId: event.businessId,
      referenceId: `${String(event.payload.actionId)}:approved`,
      title: 'An action was approved',
      message: 'An action you approved is now cleared to execute.',
      severity: 'info',
      actionUrl: `/actions/${encodeURIComponent(String(event.payload.actionId))}`,
      occurredAt: event.timestamp,
    });
  });

  const unsubscribeCompleted = input.bus.subscribe('action.completed', (event) => {
    const result = event.payload.result;
    const success = typeof result.success === 'boolean' ? result.success : undefined;
    void deliver(input, dedupe, {
      kind: 'action_completed',
      businessId: event.businessId,
      referenceId: `${String(event.payload.actionId)}:completed:${success === true ? 'ok' : 'failed'}`,
      title: success === true ? 'An action completed' : 'An action did not complete',
      message:
        success === true
          ? 'The approved action finished successfully.'
          : 'The approved action did not finish successfully. Review it before retrying.',
      severity: success === true ? 'success' : 'warning',
      actionUrl: `/actions/${encodeURIComponent(String(event.payload.actionId))}`,
      occurredAt: event.timestamp,
    });
  });

  return () => {
    unsubscribeLeak();
    unsubscribeRisk();
    unsubscribeProposed();
    unsubscribeApproved();
    unsubscribeCompleted();
  };
}

async function deliver(
  input: { sink: AlertSink; recipients: AlertRecipientResolver; now: () => Date },
  dedupe: AlertDedupeStore,
  draft: {
    kind: IntelligenceAlertKind;
    businessId: BusinessId;
    referenceId: string;
    title: string;
    message: string;
    severity: IntelligenceAlert['severity'];
    actionUrl: string;
    occurredAt: Date;
  },
): Promise<void> {
  const now = input.now();
  const dedupeKey = alertDedupeKey(draft.businessId, draft.kind, draft.referenceId);
  if (dedupe.wasSeen(draft.businessId, dedupeKey, now)) return;
  dedupe.remember(draft.businessId, dedupeKey, now);

  const recipients = await input.recipients.resolveRecipients(draft.businessId, draft.kind);
  for (const userId of recipients) {
    await input.sink.deliver({
      businessId: draft.businessId,
      userId,
      type: typeForKind(draft.kind),
      title: draft.title,
      message: draft.message,
      severity: draft.severity,
      actionUrl: draft.actionUrl,
      referenceId: draft.referenceId,
      dedupeKey,
      occurredAt: draft.occurredAt,
    });
  }
}

function typeForKind(kind: IntelligenceAlertKind): IntelligenceAlert['type'] {
  switch (kind) {
    case 'profit_leak':
      return 'profit_leak_detected';
    case 'cash_flow_risk':
      return 'cash_flow_risk';
    case 'action_proposed':
    case 'action_approved':
      return 'action_proposed';
    case 'action_completed':
      return 'action_completed';
  }
}

/** Turns a snake_case identifier into a readable label, without inventing facts. */
export function humaniseCategory(category: string): string {
  const words = category.replace(/_/g, ' ').trim();
  return words.length === 0 ? category : words;
}

function humaniseRiskType(type: string): string {
  return humaniseCategory(type);
}

function humaniseActionType(type: string): string {
  return humaniseCategory(type);
}

function humaniseSource(source: string): string {
  return humaniseCategory(source);
}

/**
 * Formats minor units for display.
 *
 * Uses the currency's own minor-unit convention for INR (2 decimals) so a
 * merchant sees rupees and paise rather than a raw integer.
 */
export function formatMinorUnits(minor: number): string {
  const major = minor / 100;
  return major.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function isoDay(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') return value.slice(0, 10);
  return 'unknown';
}