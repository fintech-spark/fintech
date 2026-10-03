// Merchant Brain: server-side API client.
//
// Runs on the server only. It forwards the caller's session cookie so the
// backend can derive `businessId` itself — the UI never supplies a tenant id
// (AI_CONTEXT.md §6, and the backend derives it from `auth_user_businesses()`).
//
// Three properties this file exists to guarantee:
//
//   1. **No caching of tenant data by default.** Business values go stale and
//      a stale rupee is a lie. Reads are `no-store`; caching is opted into
//      explicitly by a named caller, never by accident.
//   2. **No secret leakage.** No `NEXT_PUBLIC_` prefix, no token in a URL, no
//      cookie forwarded to a third-party host. `assertInternalUrl` refuses to
//      send the session anywhere but this origin.
//   3. **Contract decoding.** Every response is validated with Zod. "Valid
//      JSON is not trustworthy JSON" (AI_CONTEXT.md §10.4).

import "server-only";

import { cookies, headers } from "next/headers";
import { z } from "zod";

import {
  ApiError,
  CapabilityUnavailableError,
  apiErrorFromBody,
  contractError,
  decodeError,
  networkError,
  notFoundIsMissingRoute,
} from "./errors";

/** Response envelope from `lib/http/handler.ts`. */
interface ApiEnvelope<T> {
  readonly data: T;
  readonly meta?: Record<string, unknown>;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

/** Thrown when a route exists but the business is not wired to a database. */
export interface RequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
  /** Opt in to a short cache. Never used for money a merchant will act on. */
  readonly revalidateSeconds?: number;
  /**
   * Capability name used when the route is missing, so the UI can say
   * "not available yet" instead of "not found".
   */
  readonly capability?: string;
  /** Send an idempotency key for retry-sensitive writes. */
  readonly idempotencyKey?: string;
}

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Refuses to forward the merchant's session cookie off-origin. A configurable
 * base URL is a genuine SSRF / session-leak vector, so it must be explicit.
 */
function assertInternalUrl(url: string): void {
  if (!ABSOLUTE_URL.test(url)) return; // relative → same origin, safe
  const configured = process.env.API_INTERNAL_BASE_URL;
  if (!configured) {
    throw contractError(
      "Refusing to call an absolute API URL: set API_INTERNAL_BASE_URL to this deployment's own origin.",
    );
  }
  const target = new URL(url);
  const allowed = new URL(configured);
  if (target.origin !== allowed.origin) {
    throw contractError(
      `Refusing to forward the session cookie to ${target.origin}.`,
    );
  }
}

async function sessionCookieHeader(): Promise<string> {
  const jar = await cookies();
  return jar
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function buildUrl(
  path: string,
  query: RequestOptions["query"],
  baseUrl: string | undefined,
): string {
  assertInternalUrl(path);
  const url = new URL(path, baseUrl ?? "http://127.0.0.1");
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return baseUrl ? url.toString() : `${url.pathname}${url.search}`;
}

async function baseUrl(): Promise<string | undefined> {
  // A same-origin relative fetch in a Server Component needs no base. When an
  // internal base is configured we use it so the request leaves the server as
  // a real HTTP call rather than a self-fetch.
  const configured = process.env.API_INTERNAL_BASE_URL;
  if (!configured) return undefined;
  assertInternalUrl(configured);
  return configured;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A non-JSON body from our own API means something is badly wrong.
    return null;
  }
}

/**
 * Performs one API call and returns the decoded `data` plus `meta`.
 *
 * `schema` validates the payload. A response that does not match becomes a
 * `ContractError` — never a partially-rendered page.
 */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<{ readonly data: T; readonly meta: Record<string, unknown> | null }> {
  const origin = await baseUrl();
  const url = buildUrl(path, options.query, origin);
  const method = options.method ?? "GET";

  const requestHeaders = new Headers({ accept: "application/json" });
  const cookieHeader = await sessionCookieHeader();
  if (cookieHeader) requestHeaders.set("cookie", cookieHeader);

  const incoming = await headers();
  const correlationId = incoming.get("x-correlation-id");
  if (correlationId) requestHeaders.set("x-correlation-id", correlationId);

  if (options.body !== undefined) {
    requestHeaders.set("content-type", "application/json");
  }
  if (options.idempotencyKey) {
    requestHeaders.set("idempotency-key", options.idempotencyKey);
  }

  const cacheMode: RequestCache =
    options.revalidateSeconds === undefined ? "no-store" : "default";

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: cacheMode,
      ...(options.revalidateSeconds === undefined
        ? {}
        : { next: { revalidate: options.revalidateSeconds } }),
    });
  } catch (cause) {
    // We do not know whether the server received the request. Callers that
    // mutate must surface this as indeterminate, not failed.
    throw networkError(cause);
  }

  const body = await readBody(response);

  if (!response.ok) {
    if (notFoundIsMissingRoute(response.status, body)) {
      throw new CapabilityUnavailableError(
        options.capability ?? "This part of Merchant Brain",
      );
    }
    throw apiErrorFromBody(response.status, body);
  }

  const envelope = body as Partial<ApiEnvelope<unknown>> | null;
  if (!envelope || !("data" in envelope)) {
    throw contractError("Response was not an ApiEnvelope");
  }

  const parsed = schema.safeParse(envelope.data);
  if (!parsed.success) {
    throw decodeError(parsed.error);
  }

  return {
    data: parsed.data,
    meta: (envelope.meta as Record<string, unknown> | undefined) ?? null,
  };
}

/** Decodes the standard pagination `meta` block. */
export function pageFrom<T>(
  items: readonly T[],
  meta: Record<string, unknown> | null,
  fallbackPage: number,
  fallbackLimit: number,
): Page<T> {
  const total = typeof meta?.total === "number" ? meta.total : items.length;
  const page = typeof meta?.page === "number" ? meta.page : fallbackPage;
  const limit = typeof meta?.limit === "number" ? meta.limit : fallbackLimit;
  const hasMore =
    typeof meta?.hasMore === "boolean" ? meta.hasMore : page * limit < total;
  return { items, total, page, limit, hasMore };
}

/** Builds a query string for a paginated list. */
export function listQuery(input: {
  readonly page: number;
  readonly limit: number;
  readonly filters?: Readonly<Record<string, string | number | boolean | undefined>>;
}): Record<string, string | number | boolean | undefined> {
  return {
    page: input.page,
    limit: Math.min(Math.max(input.limit, 1), 100),
    ...input.filters,
  };
}

export { ApiError, CapabilityUnavailableError };