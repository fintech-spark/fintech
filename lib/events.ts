import type { BusinessId, UserId, TransactionId, DocumentId, ActionId } from './types';

export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  readonly id: string;
  readonly type: TType;
  readonly businessId: BusinessId;
  readonly timestamp: Date;
  readonly correlationId: string;
  readonly actorId?: UserId;
  readonly payload: TPayload;
}

export type DocumentApprovedEvent = DomainEvent<'document.approved', {
  readonly documentId: DocumentId;
  readonly sourceType: string;
  readonly extractedEntityIds: readonly string[];
}>;

export type DocumentProcessedEvent = DomainEvent<'document.processed', {
  readonly documentId: DocumentId;
  readonly status: string;
}>;

export type TransactionCreatedEvent = DomainEvent<'transaction.created', {
  readonly transactionId: TransactionId;
  readonly type: 'sale' | 'purchase' | 'payment' | 'refund';
  readonly totalMinorUnits: number;
  readonly currency: string;
}>;

export type TransactionUpdatedEvent = DomainEvent<'transaction.updated', {
  readonly transactionId: TransactionId;
  readonly status: string;
}>;

export type InventoryChangedEvent = DomainEvent<'inventory.changed', {
  readonly productId: string;
  readonly previousStock: number;
  readonly newStock: number;
  readonly reason: string;
}>;

export type PaymentRecordedEvent = DomainEvent<'payment.recorded', {
  readonly paymentId: string;
  readonly amountMinorUnits: number;
  readonly counterpartyId: string;
}>;

export type ProfitLeakDetectedEvent = DomainEvent<'profit_leak.detected', {
  readonly leakId: string;
  readonly category: string;
  readonly estimatedLossMinorUnits: number;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
}>;

export type CashFlowRiskDetectedEvent = DomainEvent<'cash_flow.risk_detected', {
  readonly riskType: string;
  readonly projectedShortfallMinorUnits: number;
  readonly projectedDate: Date;
}>;

export type ActionProposedEvent = DomainEvent<'action.proposed', {
  readonly actionId: ActionId;
  readonly type: string;
  readonly source: string;
}>;

export type ActionApprovedEvent = DomainEvent<'action.approved', {
  readonly actionId: ActionId;
  readonly approvedBy: UserId;
}>;

export type ActionCompletedEvent = DomainEvent<'action.completed', {
  readonly actionId: ActionId;
  readonly result: Record<string, unknown>;
}>;

export type AppDomainEvents =
  | DocumentApprovedEvent
  | DocumentProcessedEvent
  | TransactionCreatedEvent
  | TransactionUpdatedEvent
  | InventoryChangedEvent
  | PaymentRecordedEvent
  | ProfitLeakDetectedEvent
  | CashFlowRiskDetectedEvent
  | ActionProposedEvent
  | ActionApprovedEvent
  | ActionCompletedEvent;

export type EventHandler<E extends DomainEvent = AppDomainEvents> = (event: E) => Promise<void> | void;

export type ExtractDomainEvent<T extends AppDomainEvents['type']> = Extract<AppDomainEvents, { type: T }>;

export interface EventBus {
  publish<E extends AppDomainEvents>(event: E): Promise<void>;
  subscribe<T extends AppDomainEvents['type']>(
    eventType: T,
    handler: (event: ExtractDomainEvent<T>) => Promise<void> | void,
  ): () => void;
}

type GenericHandler = (event: AppDomainEvents) => Promise<void> | void;

export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<GenericHandler>>();

  return {
    async publish<E extends AppDomainEvents>(event: E): Promise<void> {
      const typeHandlers = handlers.get(event.type);
      if (!typeHandlers || typeHandlers.size === 0) return;

      const promises = Array.from(typeHandlers).map(async (handler) => {
        try {
          await handler(event);
        } catch (error) {
          console.error(`Error handling event "${event.type}" (ID: ${event.id}):`, error);
        }
      });

      await Promise.all(promises);
    },

    subscribe<T extends AppDomainEvents['type']>(
      eventType: T,
      handler: (event: ExtractDomainEvent<T>) => Promise<void> | void,
    ): () => void {
      if (!handlers.has(eventType)) {
        handlers.set(eventType, new Set());
      }
      const set = handlers.get(eventType)!;
      set.add(handler as unknown as GenericHandler);

      return () => {
        set.delete(handler as unknown as GenericHandler);
        if (set.size === 0) {
          handlers.delete(eventType);
        }
      };
    },
  };
}

export const eventBus = createEventBus();
