import type { TenantContext } from '@/lib/types';
import type { Business, BusinessProfile, BusinessSettings, BusinessMembership } from '../domain/types';
export interface BusinessService {
  getById(ctx: TenantContext): Promise<Business>;
  updateProfile(ctx: TenantContext, profile: Partial<BusinessProfile>): Promise<Business>;
  updateSettings(ctx: TenantContext, settings: Partial<BusinessSettings>): Promise<Business>;
  getMembers(ctx: TenantContext): Promise<readonly BusinessMembership[]>;
}
export interface CreateBusinessInput { readonly name: string; readonly type: string; readonly profile: Partial<BusinessProfile>; readonly settings?: Partial<BusinessSettings>; }
