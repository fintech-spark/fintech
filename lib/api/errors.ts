// Merchant Brain: HTTP error model for the frontend.
//
// Mirrors `lib/http/errors.ts` on the backend, which guarantees every failure
// arrives as `{ error: { name, code, message, statusCode, details? } }` and
// never leaks SQL, stack traces or provider internals.
//
// The merchant-facing string is chosen HERE, in the UI layer, because the
// merchant is our audience. The backend `message` is treated as a safe but
// technical fallback and is never shown raw when we can do better
// (web-design-guidelines: error messages explain the fix, not just the
// problem).

import type { ZodError } from "zod";

/** Error names emitted by the backend error handler. */
export type ApiErrorName =
  | "AuthenticationError"
  | "AuthorizationError"
  | "ValidationError"
  | "NotFoundError"
  | "ConflictError"
  | "BusinessRuleError"
  | "DatabaseError"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  readonly error: {
    readonly name: string;
    readonly code: string;
    readonly message: string;
    readonly statusCode: number;
    readonly details?: Record<string, unknown>;
  };
}

/**
 * A failed API call, already translated into something a merchant can act on.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly name: ApiErrorName | string;
  /** Human-readable cause, safe to render. */
  readonly userMessage: string;
  /** What the merchant can do next. Never empty. */
  readonly recovery: string;
  /** Field-level messages, when the backend validated a body. */
  readonly fieldErrors: Readonly<Record<string, string>>;
  /** Correlation id for support, when the backend supplied one. */
  readonly reference: string | null;

  constructor(init: {
    readonly name: string;
    readonly code: string;
    readonly statusCode: number;
    readonly userMessage: string;
    readonly recovery: string;
    readonly fieldErrors?: Readonly<Record<string, string>>;
    readonly reference?: string | null;
    readonly technicalMessage?: string;
  }) {
    super(init.technicalMessage ?? init.userMessage);
    this.name = init.name;
    this.code = init.code;
    this.statusCode = init.statusCode;
    this.userMessage = init.userMessage;
    this.recovery = init.recovery;
    this.fieldErrors = init.fieldErrors ?? {};
    this.reference = init.reference ?? null;
  }

  /** The merchant is not signed in, or the session expired. */
  get isUnauthenticated(): boolean {
    return this.statusCode === 401;
  }

  /** The merchant is signed in but may not do this. */
  get isForbidden(): boolean {
    return this.statusCode === 403;
  }

  /**
   * The endpoint does not exist yet. This is a real state in this repository
   * — several intelligence capabilities have no approved route — and it must
   * never be presented as "no data".
   */
  get isNotImplemented(): boolean {
    return this.statusCode === 404 && this.code === "NOT_IMPLEMENTED";
  }

  get isNotFound(): boolean {
    return this.statusCode === 404;
  }

  get isValidation(): boolean {
    return this.statusCode === 400;
  }

  /**
   * We do not know whether the mutation landed. Approval flows must NOT
   * assume success or failure here (see the action-approval safety rule).
   */
  get isIndeterminate(): boolean {
    return this.statusCode === 0 || this.statusCode >= 502;
  }
}

const MESSAGES: Readonly<Record<string, { readonly message: string; readonly recovery: string }>> = {
  AuthenticationError: {
    message: "You are signed out, so we could not load your business.",
    recovery: "Sign in again to continue.",
  },
  AuthorizationError: {
    message: "Your role does not allow this.",
    recovery: "Ask the business owner to grant access, or ask them to do this for you.",
  },
  NotFoundError: {
    message: "We could not find that record.",
    recovery: "It may have been removed. Go back and try again.",
  },
  ConflictError: {
    message: "This was already recorded, so nothing was changed.",
    recovery: "Refresh to see the current record.",
  },
  ValidationError: {
    message: "Some of the details were not accepted.",
    recovery: "Correct the highlighted fields and try again.",
  },
  BusinessRuleError: {
    message: "This change breaks a rule we cannot bypass.",
    recovery: "Adjust the values and try again.",
  },
  DatabaseError: {
    message: "We could not save or load that just now.",
    recovery: "Try again in a moment. If it keeps happening, contact support.",
  },
  INTERNAL_ERROR: {
    message: "Something went wrong on our side.",
    recovery: "Try again. If it keeps happening, contact support.",
  },
};

/**
 * A capability whose backend route has not been built yet.
 *
 * The frontend keeps this distinct from `NotFoundError` because the two mean
 * very different things to a merchant: "that record is gone" versus "this
 * part of Merchant Brain is not switched on yet". Rendering both as an empty
 * screen would be dishonest.
 */
export class CapabilityUnavailableError extends ApiError {
  constructor(readonly capability: string) {
    super({
      name: "CapabilityUnavailable",
      code: "NOT_IMPLEMENTED",
      statusCode: 404,
      userMessage: `${capability} is not available yet.`,
      recovery:
        "The backend for this part of Merchant Brain has not been built. Nothing is being hidden from you — the numbers simply do not exist yet.",
    });
  }
}

/** Turns a failed response into an `ApiError` with merchant-facing copy. */
export function apiErrorFromBody(
  statusCode: number,
  body: unknown,
): ApiError {
  const parsed = body as Partial<ApiErrorBody> | null;
  const error = parsed?.error;
  const name = typeof error?.name === "string" ? error.name : "INTERNAL_ERROR";
  const code = typeof error?.code === "string" ? error.code : "UNKNOWN";
  const technical =
    typeof error?.message === "string" ? error.message : "Request failed";

  const template = MESSAGES[name] ?? MESSAGES.INTERNAL_ERROR;
  const details = error?.details;
  const fieldErrors = readFieldErrors(details);
  const reference =
    details && typeof details.correlationId === "string" ? details.correlationId : null;

  return new ApiError({
    name,
    code,
    statusCode: typeof error?.statusCode === "number" ? error.statusCode : statusCode,
    userMessage: template.message,
    recovery: template.recovery,
    fieldErrors,
    reference,
    technicalMessage: technical,
  });
}

/** An empty 404 means the route itself is absent — an unbuilt capability. */
export function notFoundIsMissingRoute(statusCode: number, body: unknown): boolean {
  if (statusCode !== 404) return false;
  const error = (body as Partial<ApiErrorBody> | null)?.error;
  return !error || typeof error.code !== "string";
}

/** Network-level failure: we genuinely do not know what happened server-side. */
export function networkError(cause: unknown): ApiError {
  return new ApiError({
    name: "NetworkError",
    code: "NETWORK_UNAVAILABLE",
    statusCode: 0,
    userMessage: "We could not reach Merchant Brain.",
    recovery:
      "Check your connection and try again. Nothing you submitted has been lost.",
    technicalMessage: cause instanceof Error ? cause.message : "Network request failed",
  });
}

/** A response that did not match the agreed contract. Never rendered raw. */
export function contractError(cause: unknown): ApiError {
  return new ApiError({
    name: "ContractError",
    code: "UNEXPECTED_RESPONSE",
    statusCode: 502,
    userMessage: "Merchant Brain sent something we could not read.",
    recovery:
      "This is a problem on our side, not with your data. Try again, and contact support if it continues.",
    technicalMessage:
      cause instanceof Error ? cause.message : "Response did not match the API contract",
  });
}

/** Validation failure of a RESPONSE body against our Zod decoder. */
export function decodeError(error: ZodError): ApiError {
  return new ApiError({
    name: "ContractError",
    code: "UNEXPECTED_RESPONSE",
    statusCode: 502,
    userMessage: "Merchant Brain sent something we could not read.",
    recovery:
      "This is a problem on our side, not with your data. Try again, and contact support if it continues.",
    fieldErrors: Object.fromEntries(
      error.issues.map((issue) => [issue.path.join(".") || "response", issue.message]),
    ),
    technicalMessage: error.message,
  });
}

function readFieldErrors(
  details: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!details) return {};
  const nested = details.fieldErrors ?? details.errors;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
      if (typeof value === "string") result[key] = value;
      else if (Array.isArray(value) && typeof value[0] === "string") result[key] = value[0];
    }
    return result;
  }
  if (Array.isArray(nested)) {
    const result: Record<string, string> = {};
    for (const issue of nested) {
      if (
        issue &&
        typeof issue === "object" &&
        typeof (issue as { message?: unknown }).message === "string"
      ) {
        const field =
          typeof (issue as { field?: unknown }).field === "string"
            ? ((issue as { field: string }).field)
            : "request";
        result[field] = (issue as { message: string }).message;
      }
    }
    return result;
  }
  return {};
}

/** A short, quotable reference for support conversations. */
export function supportReference(error: ApiError): string | null {
  return error.reference;
}