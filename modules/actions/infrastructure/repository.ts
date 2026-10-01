import type { BusinessId, ActionId, PaginatedResult } from '@/lib/types';
import type { Action } from '../domain/types';
import type { ActionFilters } from '../application/service';
export interface ActionRepository {
  findById(businessId: BusinessId, id: ActionId): Promise<Action | null>;
  save(action: Action): Promise<Action>;
  update(action: Action): Promise<Action>;
  list(businessId: BusinessId, filters: ActionFilters): Promise<PaginatedResult<Action>>;
  findPendingApproval(businessId: BusinessId): Promise<readonly Action[]>;
}
