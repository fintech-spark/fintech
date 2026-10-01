import type { TenantContext, PaginatedResult, PaginationParams, ActionId } from '@/lib/types';
import type { Action, ActionStatus, ActionType, ActionSource } from '../domain/types';
export interface ActionService {
  propose(ctx: TenantContext, input: ProposeActionInput): Promise<Action>;
  getById(ctx: TenantContext, id: ActionId): Promise<Action | null>;
  list(ctx: TenantContext, filters: ActionFilters): Promise<PaginatedResult<Action>>;
  approve(ctx: TenantContext, id: ActionId): Promise<Action>;
  execute(ctx: TenantContext, id: ActionId): Promise<Action>;
  cancel(ctx: TenantContext, id: ActionId): Promise<Action>;
}
export interface ProposeActionInput { readonly type: ActionType; readonly title: string; readonly description: string; readonly source: ActionSource; readonly parameters: Record<string, unknown>; }
export interface ActionFilters extends PaginationParams { readonly type?: ActionType; readonly status?: ActionStatus; readonly source?: ActionSource; }
