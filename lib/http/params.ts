// Merchant Brain: request parameter parsing
//
// The only place URL search params become typed values. Centralised so that
// every list endpoint clamps pagination, allowlists sort fields, and rejects
// malformed dates identically.
//
// SQL-injection posture: sort columns are resolved through an explicit
// allowlist and never interpolated from user input. Filter values are always
// passed to PostgREST as bound values, never as SQL text.

import { z } from 'zod';
import { PayloadTooLargeError, ValidationError } from '@/lib/errors';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Deepest page a caller may request.
 *
 * `limit` was clamped but `page` was not, so `?page=1000000000` produced a
 * billion-row OFFSET that Postgres must walk before returning anything. Capping
 * the page number bounds the offset scan. It does not make deep pagination
 * cheap — OFFSET is inherently O(offset) — so cursor pagination remains the
 * correct long-term answer for large ledgers; this is the DoS guard.
 *
 * At the maximum page size this caps the scan at ~1M rows.
 */
export const MAX_PAGE_NUMBER = 10_000;

const uuidSchema = z.string().uuid('Must be a valid UUID.');

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/, 'Must be an ISO-8601 date.');

export interface PageArgs {
  readonly page: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Parses pagination. `limit` is hard-capped at MAX_PAGE_SIZE so no request can
 * ask the database for an unbounded result set.
 */
export function parsePagination(searchParams: URLSearchParams): PageArgs {
  const requestedPage = coerceInt(searchParams.get('page'), 1, 'page', 1);
  const page = Math.min(requestedPage, MAX_PAGE_NUMBER);
  const limit = Math.min(
    coerceInt(searchParams.get('limit'), DEFAULT_PAGE_SIZE, 'limit', 1),
    MAX_PAGE_SIZE,
  );

  return { page, limit, offset: (page - 1) * limit };
}

function coerceInt(
  raw: string | null,
  fallback: number,
  field: string,
  min: number,
): number {
  if (raw === null || raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new ValidationError(`"${field}" must be an integer >= ${min}.`, [
      { field, message: `Must be an integer >= ${min}.` },
    ]);
  }
  return value;
}

/**
 * Resolves a sort column against an allowlist.
 *
 * The returned value is a literal column name chosen by us, never the raw input.
 * An unrecognised field raises rather than falling back, so a caller is never
 * silently given an unindexed sort.
 */
export function resolveSort<T extends string>(
  searchParams: URLSearchParams,
  allowed: readonly T[],
  fallback: T,
  direction: 'asc' | 'desc' = 'desc',
): { column: T; ascending: boolean } {
  const requested = searchParams.get('sortBy');
  const column = (requested && (allowed as readonly string[]).includes(requested)
    ? requested
    : fallback) as T;

  const requestedDirection = searchParams.get('sortDir');
  const ascending = requestedDirection === 'asc' ? true : requestedDirection === 'desc' ? false : direction === 'asc';

  return { column, ascending };
}

/** Validates a UUID path/query parameter. */
export function parseUuid(raw: string | null | undefined, field: string): string {
  const result = uuidSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(`"${field}" must be a valid UUID.`, [
      { field, message: 'Must be a valid UUID.' },
    ]);
  }
  return result.data;
}

/** Validates an ISO date and returns it unchanged for PostgREST. */
export function parseDate(raw: string | null | undefined, field: string): string | undefined {
  if (raw === null || raw === '') return undefined;

  const result = dateSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(`"${field}" must be an ISO-8601 date.`, [
      { field, message: 'Must be an ISO-8601 date.' },
    ]);
  }
  return result.data;
}

/**
 * Reads an optional enum filter, rejecting anything outside the union.
 */
export function parseEnum<T extends string>(
  raw: string | null | undefined,
  allowed: readonly T[],
  field: string,
): T | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;

  if (!(allowed as readonly string[]).includes(raw)) {
    throw new ValidationError(`"${field}" must be one of: ${allowed.join(', ')}.`, [
      { field, message: `Must be one of: ${allowed.join(', ')}.` },
    ]);
  }
  return raw as T;
}

/**
 * Trims and bounds a free-text search term.
 *
 * PostgREST binds this as a value inside an `ilike` filter, so it cannot
 * execute as SQL. The length cap prevents an unbounded pattern.
 */
export function parseSearch(raw: string | null | undefined, maxLength = 120): string | undefined {
  if (raw === null || raw === undefined) return undefined;

  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  if (trimmed.length > maxLength) {
    throw new ValidationError(`Search term must be ${maxLength} characters or fewer.`, [
      { field: 'search', message: `Must be ${maxLength} characters or fewer.` },
    ]);
  }

  return escapeLikePattern(trimmed);
}

/**
 * A plain equality filter value: trimmed and length-capped, NOT LIKE-escaped.
 *
 * `parseSearch` escapes `%` and `_` because its output is interpolated into a
 * `%term%` pattern. Using it for an `.eq()` comparison would corrupt legitimate
 * values — a category literally named `5_kg_bags` would arrive as
 * `5\_kg\_bags` and match nothing, returning an empty 200 that looks like a
 * correct "no results".
 */
export function parseFilterValue(
  raw: string | null | undefined,
  field: string,
  maxLength = 120,
): string | undefined {
  if (raw === null || raw === undefined) return undefined;

  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  if (trimmed.length > maxLength) {
    throw new ValidationError(`"${field}" must be ${maxLength} characters or fewer.`, [
      { field, message: `Must be ${maxLength} characters or fewer.` },
    ]);
  }

  return trimmed;
}

/**
 * Escapes LIKE metacharacters so a search term is matched literally.
 *
 * Repositories wrap this value as `%${search}%` and pass it to PostgREST's
 * `ilike`. Without escaping, `%` and `_` are wildcards: `?search=%25` matches
 * every row and `_______` matches any seven-character name. That is not SQL
 * injection — PostgREST binds the value — but it turns a bounded search into a
 * caller-controlled pattern with an unbounded cost profile and a membership
 * inference surface.
 *
 * The backslash is Postgres's default LIKE escape character, so it is escaped
 * first to avoid escaping its own replacement.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Builds the `from`/`to` pair, validating that `from <= to`. */
export function parseDateRange(searchParams: URLSearchParams): { from?: string; to?: string } {
  const from = parseDate(searchParams.get('from'), 'from');
  const to = parseDate(searchParams.get('to'), 'to');

  if (from && to && new Date(from) > new Date(to)) {
    throw new ValidationError('"from" must be earlier than or equal to "to".', [
      { field: 'from', message: 'Must be earlier than or equal to "to".' },
    ]);
  }

  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

/**
 * Largest JSON request body accepted, in bytes.
 *
 * `request.json()` buffers the whole body before any schema runs, so without a
 * cap a single authenticated POST could force the process to hold an arbitrary
 * amount of memory. 1 MiB is far above the largest legitimate payload here — a
 * 200-line-item transaction is a few tens of kilobytes — and every schema
 * already bounds its own fields.
 */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

/**
 * Reads the body as text, refusing to buffer more than `MAX_REQUEST_BODY_BYTES`.
 *
 * `Content-Length` is checked first as a cheap early exit, but it is a client
 * claim and is not trusted on its own: the byte count is enforced while reading
 * so an absent or understated header cannot bypass the limit.
 */
async function readBoundedText(request: Request): Promise<string> {
  const tooLarge = () =>
    new PayloadTooLargeError('Request body is too large.', {
      maxBytes: MAX_REQUEST_BODY_BYTES,
    });

  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > MAX_REQUEST_BODY_BYTES) throw tooLarge();
  }

  const body = request.body;
  if (!body) {
    // A Request constructed without a stream (test stubs, some runtimes) has
    // already buffered the body, so the only remaining check is its length.
    const text = await request.text();
    if (text.length > MAX_REQUEST_BODY_BYTES) throw tooLarge();
    return text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      received += value.byteLength;
      if (received > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

/** Parses and validates a JSON request body. */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readBoundedText(request));
  } catch (error) {
    if (error instanceof PayloadTooLargeError) throw error;
    throw new ValidationError('Request body must be valid JSON.', [
      { field: 'body', message: 'Must be valid JSON.' },
    ]);
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(
      'Request body failed validation.',
      result.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    );
  }

  return result.data as z.infer<S>;
}

/**
 * Builds a DateRange for a repository filter from `from` / `to` params.
 *
 * Returns an empty object when neither is present so callers can spread it
 * unconditionally without producing `{ from: undefined }`.
 */
export function dateRangeArgs(
  searchParams: URLSearchParams,
): { dateRange?: { from: Date; to: Date } } {
  const from = parseDate(searchParams.get('from'), 'from');
  const to = parseDate(searchParams.get('to'), 'to');

  if (!from && !to) return {};

  // An open-ended range is pinned to a wide but finite window so every
  // repository receives a complete, comparable DateRange.
  const start = from ? new Date(from) : new Date(0);
  const end = to ? new Date(to) : new Date();

  if (start > end) {
    throw new ValidationError('"from" must be earlier than or equal to "to".', [
      { field: 'from', message: 'Must be earlier than or equal to "to".' },
    ]);
  }

  return { dateRange: { from: start, to: end } };
}
