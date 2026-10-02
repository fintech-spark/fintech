// Merchant Brain: route handler wrapper
//
// Every route is `withApi(handler)`. The wrapper owns the try/catch and the
// response shape, so a handler can only return data — never an ad-hoc error.

import { NextResponse } from 'next/server';
import { toErrorResponse } from './errors';
import { asBusinessId } from '@/lib/types';

export interface ApiSuccess<T> {
  readonly data: T;
  readonly meta?: Record<string, unknown>;
}

export interface RouteContext {
  readonly params: Record<string, string>;
}

/**
 * Next.js 15+ passes route context with `params` as a Promise.
 *
 * The wrapper awaits it before handing a plain record to the handler, so route
 * bodies read `route.params.id` synchronously and stay compatible with the
 * framework's generated route validators.
 */
export type NextRouteContext = { params: Promise<Record<string, string>> };

export type ApiHandler<T> = (request: Request, context: RouteContext) => Promise<ApiSuccess<T>>;

/** Wraps a handler with uniform success and error responses. */
export function withApi<T>(handler: ApiHandler<T>) {
  return async (request: Request, context?: NextRouteContext): Promise<Response> => {
    try {
      const params = context ? await context.params : {};
      const result = await handler(request, { params });
      return NextResponse.json(
        { data: result.data, ...(result.meta ? { meta: result.meta } : {}) },
        { status: 200 },
      );
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

/**
 * Resolves the business id from the URL path.
 *
 * `/api/businesses/[businessId]/transactions` → params.businessId
 *
 * It comes from the path, not the body — and it is still not trusted: the
 * handler must pass it to `resolveTenantContext`, which re-checks membership.
 * A caller-supplied `businessId` in a JSON body is never read.
 */
export function businessIdFromParams(params: Record<string, string>): string {
  const value = params.businessId;
  if (!value) {
    throw new Error('businessId path parameter is missing.');
  }
  return asBusinessId(value) as unknown as string;
}

/** Reads a required path parameter, e.g. `[id]`. */
export function param(params: Record<string, string>, name: string): string {
  const value = params[name];
  if (!value) {
    throw new Error(`Missing required path parameter: ${name}.`);
  }
  return value;
}