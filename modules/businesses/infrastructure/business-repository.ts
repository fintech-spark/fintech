// Merchant Brain: businesses repository and service
//
// Includes the membership listing and the profile and settings writes declared
// by BusinessService.

import 'server-only';

import type {
  BusinessId,
  Money,
  TenantContext,
  UserId,
} from '@/lib/types';
import { asBusinessId } from '@/lib/types';
import { AuthorizationError, NotFoundError } from '@/lib/errors';
import {
  type Db,
  firstOrNull,
  toDate,
  toIso,
  toOptionalString,
  unwrap,
} from '@/lib/database/query-helpers';
import { hasPermission } from '@/lib/http/auth-context';

import type { Business, BusinessMembership, BusinessProfile, BusinessSettings } from '@/modules/businesses/domain/types';
import type { BusinessService } from '@/modules/businesses/application/service';

// ===========================================================================
// Businesses
// ===========================================================================

const BUSINESS_COLUMNS = `
  id, name, type, status, display_name, industry, address, phone, email,
  gstin, pan, currency, fiscal_year_start, timezone, low_stock_threshold,
  overdue_threshold_days, created_at, updated_at
`;

interface BusinessRow {
  id: string; name: string; type: Business['type']; status: Business['status'];
  display_name: string | null; industry: string | null; address: string | null;
  phone: string | null; email: string | null; gstin: string | null; pan: string | null;
  currency: Money['currency']; fiscal_year_start: number; timezone: string;
  low_stock_threshold: number; overdue_threshold_days: number;
  created_at: string; updated_at: string;
}

function toBusiness(row: BusinessRow): Business {
  return {
    id: asBusinessId(row.id) as BusinessId,
    name: row.name,
    type: row.type,
    status: row.status,
    profile: {
      displayName: row.display_name ?? row.name,
      industry: toOptionalString(row.industry),
      address: toOptionalString(row.address),
      phone: toOptionalString(row.phone),
      email: toOptionalString(row.email),
      gstin: toOptionalString(row.gstin),
      pan: toOptionalString(row.pan),
    },
    settings: {
      currency: row.currency,
      fiscalYearStart: row.fiscal_year_start,
      timezone: row.timezone,
      lowStockThreshold: row.low_stock_threshold,
      overdueThresholdDays: row.overdue_threshold_days,
    },
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export class PostgrestBusinessRepository {
  constructor(private readonly db: Db) {}

  async findById(id: BusinessId): Promise<Business | null> {
    const row = firstOrNull<BusinessRow>(
      unwrap(await this.db.from('businesses').select(BUSINESS_COLUMNS).eq('id', id).limit(1)),
    );
    return row ? toBusiness(row) : null;
  }

  async updateProfileColumns(id: BusinessId, profile: Partial<BusinessProfile>): Promise<Business> {
    const patch: Record<string, unknown> = { updated_at: toIso(new Date()) };
    if (profile.displayName !== undefined) patch.display_name = profile.displayName;
    if (profile.industry !== undefined) patch.industry = profile.industry;
    if (profile.address !== undefined) patch.address = profile.address;
    if (profile.phone !== undefined) patch.phone = profile.phone;
    if (profile.email !== undefined) patch.email = profile.email;
    if (profile.gstin !== undefined) patch.gstin = profile.gstin;
    if (profile.pan !== undefined) patch.pan = profile.pan;

    const row = unwrap(
      await this.db.from('businesses').update(patch).eq('id', id).select(BUSINESS_COLUMNS).single(),
    ) as BusinessRow;
    return toBusiness(row);
  }

  async updateSettingColumns(id: BusinessId, settings: Partial<BusinessSettings>): Promise<Business> {
    const patch: Record<string, unknown> = { updated_at: toIso(new Date()) };
    if (settings.currency !== undefined) patch.currency = settings.currency;
    if (settings.fiscalYearStart !== undefined) patch.fiscal_year_start = settings.fiscalYearStart;
    if (settings.timezone !== undefined) patch.timezone = settings.timezone;
    if (settings.lowStockThreshold !== undefined) patch.low_stock_threshold = settings.lowStockThreshold;
    if (settings.overdueThresholdDays !== undefined) {
      patch.overdue_threshold_days = settings.overdueThresholdDays;
    }

    const row = unwrap(
      await this.db.from('businesses').update(patch).eq('id', id).select(BUSINESS_COLUMNS).single(),
    ) as BusinessRow;
    return toBusiness(row);
  }

  async memberships(businessId: BusinessId): Promise<readonly BusinessMembership[]> {
    const rows = unwrap(
      await this.db
        .from('business_members')
        .select('business_id, user_id, role, status, joined_at')
        .eq('business_id', businessId)
        .order('joined_at', { ascending: true }),
    );

    return ((rows ?? []) as Array<{
      business_id: string; user_id: string; role: BusinessMembership['role'];
      status: BusinessMembership['status']; joined_at: string;
    }>).map((row) => ({
      businessId: asBusinessId(row.business_id) as BusinessId,
      userId: row.user_id as unknown as UserId,
      role: row.role,
      status: row.status,
      joinedAt: toDate(row.joined_at),
    }));
  }

  /** Businesses the caller is an active member of, resolved by the database. */
  async listForUser(userId: UserId): Promise<readonly Business[]> {
    const { data, error } = await this.db
      .from('business_members')
      .select('business_id')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) throw error;

    const ids = ((data ?? []) as Array<{ business_id: string }>).map((r) => r.business_id);
    if (ids.length === 0) return [];

    const rows = unwrap(
      await this.db.from('businesses').select(BUSINESS_COLUMNS).in('id', ids),
    );
    return ((rows ?? []) as BusinessRow[]).map(toBusiness);
  }

  /**
   * Businesses the caller may switch to.
   *
   * Read through the RLS-enforced client, so the database itself restricts the
   * result to the caller's own memberships. There is no tenant parameter to
   * forge because RLS supplies the filter.
   */
}

export class DefaultBusinessService implements BusinessService {
  constructor(private readonly repository: PostgrestBusinessRepository) {}

  async getById(ctx: TenantContext): Promise<Business> {
    const business = await this.repository.findById(ctx.businessId);
    if (!business) throw new NotFoundError('Business', ctx.businessId);
    return business;
  }

  async getMembers(ctx: TenantContext) {
    return this.repository.memberships(ctx.businessId);
  }

  async listForUser(userId: UserId): Promise<readonly Business[]> {
    return this.repository.listForUser(userId);
  }

  /** Settings writes require owner/admin — Phase 1 rule `canManageSettings`. */
  async updateProfile(ctx: TenantContext, profile: Partial<BusinessProfile>) {
    if (!hasPermission(ctx.role, 'settings:write')) {
      throw new AuthorizationError('Missing required permission: settings:write.');
    }
    return this.repository.updateProfileColumns(ctx.businessId, profile);
  }

  async updateSettings(ctx: TenantContext, settings: Partial<BusinessSettings>) {
    if (!hasPermission(ctx.role, 'settings:write')) {
      throw new AuthorizationError('Missing required permission: settings:write.');
    }
    return this.repository.updateSettingColumns(ctx.businessId, settings);
  }
}
