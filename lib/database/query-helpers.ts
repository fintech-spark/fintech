// Merchant Brain: PostgREST helpers
//
// Shared row-mapping and query utilities for tenant-scoped repositories.
//
// Every helper here takes the caller's Supabase client, which carries their JWT.
// PostgREST therefore runs as that user and the RLS policies from migration
// 0004 apply. A repository cannot accidentally read another tenant: even a
// missing `.eq('business_id', …)` is caught by RLS.

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaginatedResult } from '@/lib/types';
import { NotFoundError } from '@/lib/errors';

export type Db = SupabaseClient;

/** Count rows matching an already-filtered query. */
export async function countRows(
  query: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number> {
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Assembles the PaginatedResult shape the domain expects. */
export function paginate<T>(
  items: readonly T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  return {
    items,
    total,
    page,
    limit,
    hasMore: page * limit < total,
  };
}

/** Reads a single row, returning null when absent. */
export function firstOrNull<T>(data: unknown): T | null {
  if (!Array.isArray(data)) return null;
  return (data[0] as T | undefined) ?? null;
}

/**
 * Throws NotFoundError for a missing row.
 *
 * Callers pass this for lookups scoped by business_id. Because the query is
 * already tenant-scoped, a row belonging to another tenant is indistinguishable
 * from one that does not exist — which is exactly what we want to return.
 */
export function requireFound<T>(value: T | null, resource: string, id: string): T {
  if (value === null) {
    throw new NotFoundError(resource, id);
  }
  return value;
}

/** Propagates a Supabase error as a thrown value. */
export function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data as T;
}

/** Formats a JS Date as the ISO string PostgREST expects for timestamptz. */
export function toIso(value: Date): string {
  return value.toISOString();
}

/** Parses a Postgres timestamptz string into a Date, tolerating null. */
export function toDate(value: string | null | undefined): Date {
  return value ? new Date(value) : new Date(0);
}

/** Parses an optional timestamptz. */
export function toOptionalDate(value: string | null | undefined): Date | undefined {
  return value ? new Date(value) : undefined;
}

/** Parses an optional text column. */
export function toOptionalString(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}