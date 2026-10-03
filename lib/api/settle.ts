// Merchant Brain: partial-failure handling for dashboard loads.
//
// The overview reads five independent, authoritative figures. They can each
// fail on their own, and a dashboard that hides one failure and shows a
// confident total for the rest is lying by omission.
//
// `settleAll` turns a batch of calls into a result the UI can be honest about:
// what loaded, what did not, and why.

import { ApiError } from "./errors";

export type Settled<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApiError };

/** Runs one call, converting a rejection into a value instead of a throw. */
export async function settle<T>(call: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await call };
  } catch (error) {
    return { ok: false, error: toApiError(error) };
  }
}

/** Runs independent calls together, preserving order. */
export async function settleAll<T extends readonly Promise<unknown>[]>(
  calls: T,
): Promise<{ -readonly [K in keyof T]: Settled<Awaited<T[K]>> }> {
  return Promise.all(Array.from(calls, (call) => settle(call))) as Promise<{
    -readonly [K in keyof T]: Settled<Awaited<T[K]>>;
  }>;
}

/** The value of a settled call, or `null` when it failed. */
export function valueOr<T, R>(settled: Settled<T>, fallback: R): T | R {
  return settled.ok ? settled.value : fallback;
}

/** The error of a settled call, or `null` when it succeeded. */
export function errorOr<T>(settled: Settled<T>): ApiError | null {
  return settled.ok ? null : settled.error;
}

/** Anything thrown in a page becomes an `ApiError` so the UI has one shape. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError({
    name: "UnknownError",
    code: "UNEXPECTED",
    statusCode: 500,
    userMessage: "Something went wrong while loading this.",
    recovery: "Try again. If it keeps happening, contact support.",
    technicalMessage: error instanceof Error ? error.message : String(error),
  });
}

/** A single sentence naming what is missing from a partially loaded screen. */
export function describeMissing(
  failures: readonly { readonly label: string; readonly error: ApiError | null }[],
): string | null {
  const missing = failures.filter(
    (failure): failure is { readonly label: string; readonly error: ApiError } =>
      failure.error !== null,
  );
  if (missing.length === 0) return null;
  if (missing.length === 1) {
    return `${missing[0].label} could not be loaded, so it is not included below.`;
  }
  const names = missing.map((failure) => failure.label).join(", ");
  return `${names} could not be loaded, so they are not included below.`;
}