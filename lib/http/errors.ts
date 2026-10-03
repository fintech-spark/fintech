// Merchant Brain: HTTP error mapping
//
// Single source of truth for turning an AppError into a safe HTTP response.
// Every route handler goes through `toErrorResponse`. Nothing else in the
// application writes an error body by hand.

import { NextResponse } from 'next/server';
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
  wrapDatabaseError,
} from '@/lib/errors';

export interface ErrorBody {
  readonly error: {
    readonly name: string;
    readonly code: string;
    readonly message: string;
    readonly statusCode: number;
    readonly details?: Record<string, unknown>;
  };
}

/**
 * Maps any thrown value to a response.
 *
 * Unrecognised errors collapse to a generic 500. The original message is NOT
 * forwarded: it can contain SQL text, constraint names, column names or
 * connection strings. Only `AppError.toJSON()` output is safe to expose.
 */
export function toErrorResponse(error: unknown): NextResponse<ErrorBody> {
  const appError = normalizeError(error);

  return NextResponse.json(
    {
      error: {
        name: appError.name,
        code: appError.code,
        message: appError.message,
        statusCode: appError.statusCode,
        ...(appError.details ? { details: appError.details } : {}),
      },
    },
    { status: appError.statusCode },
  );
}

/** Converts an unknown throwable into an AppError without leaking internals. */
export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof Error) {
    // Supabase/PostgREST errors arrive as plain Errors with a `code` or
    // `status`. wrapDatabaseError already maps 23505 / 23503 onto safe
    // DatabaseErrors; anything else becomes a generic 500.
    return wrapDatabaseError(error);
  }

  return new (class extends AppError {
    readonly code = 'INTERNAL_ERROR';
    readonly statusCode = 500;
  })('An unexpected error occurred.');
}

export { AuthenticationError, AuthorizationError, BusinessRuleError, ConflictError, NotFoundError, ValidationError };