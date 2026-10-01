import type { BusinessId, UserId, UserRole, CurrencyCode } from '@/lib/types';
export interface Business { readonly id: BusinessId; readonly name: string; readonly type: BusinessType; readonly status: BusinessStatus; readonly profile: BusinessProfile; readonly settings: BusinessSettings; readonly createdAt: Date; readonly updatedAt: Date; }
export type BusinessType = 'retail' | 'wholesale' | 'manufacturing' | 'services' | 'food_beverage' | 'other';
export type BusinessStatus = 'active' | 'suspended' | 'closed';
export interface BusinessProfile { readonly displayName: string; readonly industry?: string; readonly address?: string; readonly phone?: string; readonly email?: string; readonly gstin?: string; readonly pan?: string; }
export interface BusinessSettings { readonly currency: CurrencyCode; readonly fiscalYearStart: number; readonly timezone: string; readonly lowStockThreshold: number; readonly overdueThresholdDays: number; }
export interface BusinessMembership { readonly businessId: BusinessId; readonly userId: UserId; readonly role: UserRole; readonly joinedAt: Date; readonly status: 'active' | 'invited' | 'removed'; }
