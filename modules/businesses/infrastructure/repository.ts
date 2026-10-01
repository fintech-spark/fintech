import type { BusinessId, UserId } from '@/lib/types';
import type { Business, BusinessMembership } from '../domain/types';
export interface BusinessRepository {
  findById(id: BusinessId): Promise<Business | null>;
  save(business: Business): Promise<Business>;
  findMembershipsByBusiness(businessId: BusinessId): Promise<readonly BusinessMembership[]>;
  findMembershipByUser(businessId: BusinessId, userId: UserId): Promise<BusinessMembership | null>;
}
