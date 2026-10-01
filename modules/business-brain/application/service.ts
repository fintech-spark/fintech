import type { TenantContext } from '@/lib/types';
import type { BrainQuery, BrainResponse } from '../domain/types';
export interface BusinessBrainService {
  query(ctx: TenantContext, query: BrainQuery): Promise<BrainResponse>;
  getSessionHistory(ctx: TenantContext, sessionId: string): Promise<{ readonly messages: readonly { readonly role: string; readonly content: string; readonly timestamp: Date }[] }>;
}
