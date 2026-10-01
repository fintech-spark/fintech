import type { TenantContext, UserId, BusinessId } from '@/lib/types';
import type { AuthenticatedUser, AccessContext, Permission } from '../domain/types';
export interface AuthService {
  resolveUser(sessionToken: string): Promise<AuthenticatedUser | null>;
  establishContext(userId: UserId, businessId: BusinessId): Promise<TenantContext>;
  getAccessContext(ctx: TenantContext): Promise<AccessContext>;
  hasPermission(ctx: TenantContext, permission: Permission): Promise<boolean>;
  requirePermission(ctx: TenantContext, permission: Permission): Promise<void>;
}
