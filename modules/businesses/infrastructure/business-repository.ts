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
import { AuthenticationError, AuthorizationError, DatabaseError, NotFoundError } from '@/lib/errors';
import { MAX_MEMBERSHIP_SCAN, assertScanWithinLimit } from '@/lib/bounded-scan';
import {
  type Db,
  firstOrNull,
  toDate,
  toIso,
  toOptionalString,
  unwrap,
} from '@/lib/database/query-helpers';
import { hasPermission } from '@/lib/http/auth-context';
import { getDatabaseClient, type DatabaseClient } from '@/lib/database';
import type { Business, BusinessMembership, BusinessProfile, BusinessSettings } from '../domain/types';
import type { BusinessService, CreateBusinessInput } from '../application/service';

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
  constructor(
    private readonly db: Db,
    private readonly provisioningDb?: Pick<DatabaseClient, 'transaction'>,
  ) {}

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
        .order('joined_at', { ascending: true })
        .range(0, MAX_MEMBERSHIP_SCAN),
    );

    assertScanWithinLimit(
      (rows ?? []).length,
      MAX_MEMBERSHIP_SCAN,
      'The membership roster',
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
   * Provisions a new business and assigns the caller as active owner.
   */
  async create(userId: UserId, input: CreateBusinessInput): Promise<Business> {
    const profile = input.profile ?? {};
    const settings = input.settings ?? {};
    // Privileged bootstrap only: userId comes from requireRequestContext, never
    // the request body. PostgREST cannot create the first owner under existing RLS.
    return (this.provisioningDb ?? getDatabaseClient()).transaction(async (tx) => {
      const subjects = await tx.query<{ id: string }>(
        'SELECT id FROM auth.users WHERE id = $1 AND deleted_at IS NULL FOR SHARE',
        [userId],
      );
      if (subjects.length !== 1) throw new AuthenticationError();
      await tx.execute(
        `INSERT INTO public.users (id, email, name)
         SELECT id, email, COALESCE(raw_user_meta_data->>'name', split_part(email, '@', 1))
         FROM auth.users WHERE id = $1
         ON CONFLICT (id) DO NOTHING`,
        [userId],
      );
      const [row] = await tx.query<BusinessRow>(
        `INSERT INTO public.businesses (
          name, type, display_name, industry, address, phone, email, gstin, pan,
          currency, fiscal_year_start, timezone, low_stock_threshold, overdue_threshold_days
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING ${BUSINESS_COLUMNS}`,
        [input.name, input.type, profile.displayName ?? input.name, profile.industry ?? null,
          profile.address ?? null, profile.phone ?? null, profile.email ?? null,
          profile.gstin ?? null, profile.pan ?? null, settings.currency ?? 'INR',
          settings.fiscalYearStart ?? 1, settings.timezone ?? 'Asia/Kolkata',
          settings.lowStockThreshold ?? 5, settings.overdueThresholdDays ?? 30],
      );
      if (!row) throw new DatabaseError('Business provisioning failed.');
      const affected = await tx.execute(
        `INSERT INTO public.business_members (business_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active')`,
        [row.id, userId],
      );
      if (affected !== 1) throw new DatabaseError('Owner membership provisioning failed.');
      return toBusiness(row);
    });
  }
}

export class DefaultBusinessService implements BusinessService {
  constructor(private readonly repository: PostgrestBusinessRepository) {}

  /** Provisions a new business and assigns caller as owner. */
  async create(userId: UserId, input: CreateBusinessInput): Promise<Business> {
    return this.repository.create(userId, input);
  }

  /**
   * The full business record, including PAN and GSTIN.
   *
   * Gated on `settings:read`, which the role matrix grants to owner and admin
   * only. This is not over-restriction: the record carries tax identifiers, and
   * the matrix already defined `settings:read` for exactly this — it was simply
   * never checked, so any active member including `staff` could read them.
   */
  async getById(ctx: TenantContext): Promise<Business> {
    this.require(ctx, 'settings:read');
    const business = await this.repository.findById(ctx.businessId);
    if (!business) throw new NotFoundError('Business', ctx.businessId);
    return business;
  }

  /**
   * The membership roster: every member's user id and role.
   *
   * Gated on `settings:read` for the same reason as `getById`. Enumerating who
   * holds which role in a business is administrative information, and the
   * matrix reserves `settings:*` to owner and admin.
   */
  async getMembers(ctx: TenantContext) {
    this.require(ctx, 'settings:read');
    return this.repository.memberships(ctx.businessId);
  }

  /**
   * The caller's own businesses.
   *
   * Takes no TenantContext because it runs before one exists: it is the list a
   * caller picks a tenant FROM. It is therefore bounded by the caller's own
   * membership count, resolved by the database via `auth_user_businesses()`,
   * and cannot be pointed at another tenant. The route projects each row down
   * to id/name/type/status, so no tax identifier is returned here.
   */
  async listForUser(userId: UserId): Promise<readonly Business[]> {
    return this.repository.listForUser(userId);
  }

  /** Settings writes require owner/admin — Phase 1 rule `canManageSettings`. */
  async updateProfile(ctx: TenantContext, profile: Partial<BusinessProfile>) {
    this.require(ctx, 'settings:write');
    return this.repository.updateProfileColumns(ctx.businessId, profile);
  }

  async updateSettings(ctx: TenantContext, settings: Partial<BusinessSettings>) {
    this.require(ctx, 'settings:write');
    return this.repository.updateSettingColumns(ctx.businessId, settings);
  }

  /** Single choke point so a new method cannot forget the check. */
  private require(ctx: TenantContext, permission: Parameters<typeof hasPermission>[1]) {
    if (!hasPermission(ctx.role, permission)) {
      throw new AuthorizationError(`Missing required permission: ${permission}.`);
    }
  }
}
