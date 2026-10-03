import type { TenantContext, UserId } from '@/lib/types';
import type { Business, BusinessProfile, BusinessSettings, BusinessMembership, BusinessType } from '../domain/types';

export interface BusinessService {
  getById(ctx: TenantContext): Promise<Business>;
  updateProfile(ctx: TenantContext, profile: Partial<BusinessProfile>): Promise<Business>;
  updateSettings(ctx: TenantContext, settings: Partial<BusinessSettings>): Promise<Business>;
  getMembers(ctx: TenantContext): Promise<readonly BusinessMembership[]>;
  create(userId: UserId, input: CreateBusinessInput): Promise<Business>;
}

export interface CreateBusinessInput {
  readonly name: string;
  readonly type: BusinessType;
  readonly profile?: Partial<BusinessProfile>;
  readonly settings?: Partial<BusinessSettings>;
}
