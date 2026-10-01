import type { BusinessId, PaginatedResult } from '@/lib/types';
import type { ProfitLeak } from '../domain/types';
import type { LeakFilters } from '../application/service';
export interface ProfitLeakRepository {
  findById(businessId: BusinessId, id: string): Promise<ProfitLeak | null>;
  save(leak: ProfitLeak): Promise<ProfitLeak>;
  update(leak: ProfitLeak): Promise<ProfitLeak>;
  list(businessId: BusinessId, filters: LeakFilters): Promise<PaginatedResult<ProfitLeak>>;
  findActiveByCategory(businessId: BusinessId, category: string): Promise<readonly ProfitLeak[]>;
}
