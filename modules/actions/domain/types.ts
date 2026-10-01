import type { BusinessId, ActionId, UserId } from '@/lib/types';
export interface Action {
  readonly id: ActionId; readonly businessId: BusinessId; readonly type: ActionType; readonly title: string;
  readonly description: string; readonly status: ActionStatus; readonly source: ActionSource; readonly parameters: Record<string, unknown>;
  readonly result?: ActionResult; readonly createdAt: Date; readonly updatedAt: Date; readonly createdBy: UserId;
  readonly approvedBy?: UserId; readonly approvedAt?: Date; readonly executedAt?: Date;
}
export type ActionType = 'adjust_price' | 'reorder_stock' | 'send_reminder' | 'change_supplier' | 'reduce_expense' | 'create_transaction' | 'custom';
export type ActionStatus = 'proposed' | 'drafted' | 'awaiting_approval' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled';
export type ActionSource = 'ai_recommendation' | 'profit_leak' | 'cash_flow_risk' | 'manual';
export interface ActionResult { readonly success: boolean; readonly output?: string; readonly error?: string; readonly affectedResources?: readonly { readonly type: string; readonly id: string }[]; }
export const ACTION_STATUS_TRANSITIONS: Record<ActionStatus, readonly ActionStatus[]> = {
  proposed: ['drafted', 'cancelled'], drafted: ['awaiting_approval', 'cancelled'], awaiting_approval: ['approved', 'cancelled'],
  approved: ['executing'], executing: ['completed', 'failed'], completed: [], failed: ['drafted'], cancelled: [],
};
