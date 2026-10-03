export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;

  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';
  readonly statusCode = 404;
  constructor(resource: string, id?: string) {
    super(id ? `${resource} with id "${id}" was not found.` : `${resource} was not found.`, { resource, id });
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
  readonly statusCode = 400;
  constructor(message: string, public readonly issues?: Array<{ field: string; message: string }>) {
    super(message, { issues });
  }
}

export class AuthenticationError extends AppError {
  readonly code = 'UNAUTHENTICATED';
  readonly statusCode = 401;
  constructor(message = 'Authentication required.') { super(message); }
}

export class AuthorizationError extends AppError {
  readonly code = 'FORBIDDEN';
  readonly statusCode = 403;
  constructor(message = 'You do not have permission to perform this action.') { super(message); }
}

export class ConflictError extends AppError {
  readonly code = 'CONFLICT';
  readonly statusCode = 409;
  constructor(message: string, details?: Record<string, unknown>) { super(message, details); }
}

export class RateLimitError extends AppError {
  readonly code = 'RATE_LIMITED';
  readonly statusCode = 429;
  constructor(message = 'Too many requests. Please try again later.') { super(message); }
}

/**
 * The request body exceeded the accepted size.
 *
 * Its own class rather than a `ValidationError` because a body too large to
 * read is a different failure from a body that failed validation, and 413 tells
 * a client the request will not succeed however it is corrected.
 */
export class PayloadTooLargeError extends AppError {
  readonly code = 'PAYLOAD_TOO_LARGE';
  readonly statusCode = 413;
  constructor(message = 'Request body is too large.', details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class BusinessRuleError extends AppError {
  readonly code = 'BUSINESS_RULE_VIOLATION';
  readonly statusCode = 422;
  constructor(message: string, details?: Record<string, unknown>) { super(message, details); }
}

export class AIProviderError extends AppError {
  readonly code = 'AI_PROVIDER_ERROR';
  readonly statusCode = 502;
  constructor(message: string, public readonly provider: string, details?: Record<string, unknown>) {
    super(message, { provider, ...details });
  }
}

export class AIValidationError extends AppError {
  readonly code = 'AI_VALIDATION_ERROR';
  readonly statusCode = 502;
  constructor(message: string, public readonly rawOutput?: unknown) { super(message, { rawOutput }); }
}

export class ExtractionError extends AppError {
  readonly code = 'EXTRACTION_ERROR';
  readonly statusCode = 422;
  constructor(message: string, public readonly documentId: string, details?: Record<string, unknown>) {
    super(message, { documentId, ...details });
  }
}

/**
 * A registered AI tool failed to produce a usable result.
 *
 * Raised for the two resource conditions the registry controls — the
 * per-invocation wall clock and the serialized payload ceiling. It is
 * deliberately NOT an \`AIProviderError\`: no model was involved, so attributing
 * the failure to the provider would misdirect triage.
 */
export class ToolExecutionError extends AppError {
  readonly code = 'TOOL_EXECUTION_ERROR';
  readonly statusCode = 500;
  constructor(message: string, details?: Record<string, unknown>) { super(message, details); }
}

export class StorageError extends AppError {
  readonly code = 'STORAGE_ERROR';
  readonly statusCode = 500;
  constructor(message: string, details?: Record<string, unknown>) { super(message, details); }
}

export class DatabaseError extends AppError {
  readonly code = 'DATABASE_ERROR';
  readonly statusCode = 500;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

export function isUniqueViolationError(error: unknown): boolean {
  if (error instanceof Error && 'code' in error) {
    return (error as { code: string }).code === '23505';
  }
  return false;
}

export function isForeignKeyViolationError(error: unknown): boolean {
  if (error instanceof Error && 'code' in error) {
    return (error as { code: string }).code === '23503';
  }
  return false;
}

/**
 * Normalises a driver error into the closest `AppError`.
 *
 * Returns `AppError` rather than `DatabaseError` because the mapping is not
 * one-to-one: a unique violation is a 409 Conflict, a foreign-key violation is
 * a 400 Validation, and only an unrecognised failure is a 500 DatabaseError.
 * The declared type must admit all three.
 */
export function wrapDatabaseError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    // A unique violation is a client-visible conflict, not a server fault: the
    // caller sent something that already exists. Mapping it to DatabaseError
    // reported 500 for what is a 409, and left `ConflictError` — which exists
    // for exactly this — unused across the whole codebase.
    if (isUniqueViolationError(error)) {
      return new ConflictError('A record with this value already exists.');
    }

    // Likewise a foreign-key violation means the referenced record is absent or
    // belongs to another tenant. `ValidationError` (400) tells the client its
    // reference is wrong without implying the database is broken.
    if (isForeignKeyViolationError(error)) {
      return new ValidationError('A referenced record does not exist.');
    }

    // Nothing about the driver failure is forwarded. The message can carry SQL
    // text, column names, constraint definitions or connection strings, and the
    // SQLSTATE is no better: it names the database vendor and hands an attacker
    // a free oracle for probing which constraints exist. The HTTP status and
    // the message already say everything the client needs, and the correlation
    // id is what support should match on. The raw error belongs in a server log,
    // not in a response body.
    return new DatabaseError('A database error occurred.');
  }
  return new DatabaseError('An unknown database error occurred.');
}
