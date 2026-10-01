import type { UserId, BusinessId, UserRole } from '@/lib/types';
export interface AuthenticatedUser { readonly id: UserId; readonly email: string; readonly name: string; readonly role: UserRole; }
export interface AuthSession { readonly userId: UserId; readonly businessId: BusinessId; readonly role: UserRole; readonly expiresAt: Date; }
export interface AccessContext { readonly user: AuthenticatedUser; readonly businessId: BusinessId; readonly permissions: readonly Permission[]; }
export type Permission = 'transactions:read' | 'transactions:write' | 'inventory:read' | 'inventory:write' | 'expenses:read' | 'expenses:write' | 'customers:read' | 'customers:write' | 'suppliers:read' | 'suppliers:write' | 'documents:read' | 'documents:write' | 'analytics:read' | 'actions:read' | 'actions:approve' | 'actions:execute' | 'settings:read' | 'settings:write' | 'audit:read';
