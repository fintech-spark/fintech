import type { BusinessMembership, BusinessStatus } from './types';
export function isBusinessOperational(status: BusinessStatus): boolean { return status === 'active'; }
export function isMemberActive(membership: BusinessMembership): boolean { return membership.status === 'active'; }
export function canManageSettings(role: string): boolean { return role === 'owner' || role === 'admin'; }
export function canInviteMembers(role: string): boolean { return role === 'owner' || role === 'admin'; }
