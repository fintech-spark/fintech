// Merchant Brain: search-param helpers for Server Components.
//
// `components/data/url-state.ts` is the Client Component that WRITES these
// values. This file is the pure, server-safe half that READS them, so a Server
// Component page can decode `?status=overdue&page=3` without pulling a hook
// across the boundary.
//
// Everything is validated and bounded: a hand-edited URL must never be able to
// ask for 10,000 rows or smuggle a value into a query the backend will treat as
// a filter.

import type { ProductStatus } from "@/lib/format/status";

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Reads a single non-empty string parameter. */
export function readParam(
  params: RawSearchParams,
  key: string,
  maxLength = 120,
): string | undefined {
  const value = params[key];
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // A URL is untrusted input. Cap the length before it reaches a query.
  return trimmed.slice(0, maxLength);
}

/** Reads a bounded, positive page number. */
export function readPageNumber(
  params: RawSearchParams,
  fallback = 1,
): number {
  const raw = readParam(params, "page", 8);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : fallback;
}

/** Reads a bounded page size. The backend caps `limit` at 100. */
export function readPageSize(params: RawSearchParams, fallback = 25): number {
  const raw = readParam(params, "limit", 4);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 100);
}

/** Reads a value constrained to a known set. Anything else is ignored. */
export function readEnum<T extends string>(
  params: RawSearchParams,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const raw = readParam(params, key);
  if (!raw) return undefined;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

/** Reads a boolean-ish flag. Only the literal string `true` counts. */
export function readFlag(params: RawSearchParams, key: string): boolean {
  return readParam(params, key, 5) === "true";
}

export const PRODUCT_STATUS_VALUES = [
  "active",
  "discontinued",
  "out_of_stock",
] as const satisfies readonly ProductStatus[];

export const RECEIVABLE_STATUS_VALUES = [
  "pending",
  "partial",
  "paid",
  "overdue",
  "written_off",
] as const;

export const PAYABLE_STATUS_VALUES = [
  "pending",
  "partial",
  "paid",
  "overdue",
] as const;

export const DOCUMENT_STATUS_VALUES = [
  "uploaded",
  "validating",
  "queued",
  "processing",
  "extracted",
  "review_required",
  "approved",
  "rejected",
  "failed",
] as const;

export const PARTNER_STATUS_VALUES = ["active", "inactive"] as const;

/** Query keys used across list screens. Centralised so links agree with reads. */
export const PARAM = {
  page: "page",
  limit: "limit",
  search: "search",
  status: "status",
  category: "category",
  filter: "filter",
  sourceType: "sourceType",
} as const;