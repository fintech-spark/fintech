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
//      send the session to an origin this deployment did not name for itself.
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
 * Normalises a base-URL environment value to `scheme://host[:port]`.
 *
 * `VERCEL_URL` arrives without a scheme, and an origin is all a base is used
 * for here — the request path always wins in `new URL(path, base)`.
 */
function envOrigin(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  try {
    return new URL(ABSOLUTE_URL.test(raw) ? raw : `https://${raw}`).origin;
  } catch {
    return undefined;
  }
}

/** A loopback origin can only ever be the machine the process runs on. */
function isLoopback(origin: string): boolean {
  const host = new URL(origin).hostname;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host === "0.0.0.0"
  );
}

/**
 * Every origin this deployment may forward the merchant's session to.
 *
 * Both are server-side configuration: the configured API base and the
 * deployment URL Vercel injects for this build. Neither is read from a request,
 * so a forged `Host` cannot move the cookie — which is the point of the check.
 */
export function allowedApiOrigins(
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const origins = [
    envOrigin(env.API_INTERNAL_BASE_URL),
    envOrigin(env.VERCEL_PROJECT_PRODUCTION_URL),
    envOrigin(env.VERCEL_URL),
  ];
  return origins.filter((origin): origin is string => origin !== undefined);
}

/**
 * Picks the origin the server-side fetcher calls.
 *
 * `API_INTERNAL_BASE_URL` wins when it can genuinely be this deployment's own
 * origin. A loopback value never can be — on Vercel there is no local server to
 * reach — so the injected deployment URL is used instead. With no configured
 * base at all the client used to build a *relative* URL, which `fetch` cannot
 * parse: every page then reported the data service as unreachable even though
 * the API answered normally one path away.
 */
export function resolveApiOrigin(
  env: Readonly<Record<string, string | undefined>>,
  requestOrigin?: string,
): string | undefined {
  const configured = envOrigin(env.API_INTERNAL_BASE_URL);
  const production = envOrigin(env.VERCEL_PROJECT_PRODUCTION_URL);
  const deployment = envOrigin(env.VERCEL_URL);
  if (configured && !(deployment !== undefined && isLoopback(configured))) {
    return configured;
  }
  // When handling a request on Vercel, prefer the actual host from headers
  // (e.g. fintech-ten-xi.vercel.app) to prevent loopback hitting protected preview URLs.
  if (requestOrigin && allowedApiOrigins(env).includes(envOrigin(requestOrigin) ?? '') && !isLoopback(requestOrigin)) {
    return requestOrigin;
  }
  return production ?? deployment ?? configured;
}

/**
 * Refuses to forward the merchant's session cookie off-origin. A configurable
 * base URL is a genuine SSRF / session-leak vector, so only origins this
 * deployment named for itself are acceptable.
 */
function assertInternalUrl(url: string): void {
  if (!ABSOLUTE_URL.test(url)) return; // relative → same origin, safe
  const origin = new URL(url).origin;
  if (!allowedApiOrigins(process.env).includes(origin)) {
    throw contractError(
      `Refusing to forward the session cookie to ${origin}. Set API_INTERNAL_BASE_URL to this deployment's own origin.`,
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
  baseUrl: string,
): string {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function baseUrl(requestOrigin?: string): Promise<string> {
  // A real origin is mandatory: `fetch` rejects a relative URL outright, so a
  // missing base surfaces as an opaque network failure rather than a message
  // that says what to configure.
  const origin = resolveApiOrigin(process.env, requestOrigin);
  if (!origin) {
    throw contractError(
      "No API origin: set API_INTERNAL_BASE_URL to this deployment's own origin.",
    );
  }
  assertInternalUrl(origin);
  return origin;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      error: {
        name: "INTERNAL_ERROR",
        code: "NON_JSON_RESPONSE",
        message: text.slice(0, 300),
        statusCode: response.status,
      },
    };
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
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host");
  const proto = incoming.get("x-forwarded-proto") ?? "https";
  const requestOrigin = host ? `${proto}://${host}` : undefined;

  const origin = await baseUrl(requestOrigin);
  const url = buildUrl(path, options.query, origin);
  const method = options.method ?? "GET";

  const requestHeaders = new Headers({ accept: "application/json" });

  const correlationId = incoming.get("x-correlation-id");
  if (correlationId) requestHeaders.set("x-correlation-id", correlationId);

  const bypassSecret =
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET ??
    incoming.get("x-vercel-protection-bypass");
  if (bypassSecret) {
    requestHeaders.set("x-vercel-protection-bypass", bypassSecret);
  }

  const rawCookieHeader = incoming.get("cookie");
  const cookieHeader = rawCookieHeader ?? (await sessionCookieHeader());
  if (cookieHeader) requestHeaders.set("cookie", cookieHeader);

  // Anonymous demo requests remain anonymous; tenant resolution permits GET
  // only. Never forward a shared account token to state-changing endpoints.
  if (method !== 'GET') requestHeaders.set('origin', origin);

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
      redirect: "manual",
      ...(options.revalidateSeconds === undefined
        ? {}
        : { next: { revalidate: options.revalidateSeconds } }),
    });
  } catch (cause) {
    // We do not know whether the server received the request. Callers that
    // mutate must surface this as indeterminate, not failed.
    throw networkError(cause);
  }

  const isRedirect =
    response.status === 301 ||
    response.status === 302 ||
    response.status === 303 ||
    response.status === 307 ||
    response.status === 308 ||
    response.type === "opaqueredirect";

  if (isRedirect && path.startsWith("/api/auth/session")) {
    throw apiErrorFromBody(401, {
      error: {
        name: "AuthenticationError",
        code: "UNAUTHENTICATED",
        message: "Authentication required.",
        statusCode: 401,
      },
    });
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
