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

export function wrapDatabaseError(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) return error;
  if (error instanceof Error) {
    const pgError = error as { code?: string; constraint?: string; detail?: string };
    if (isUniqueViolationError(error)) {
      return new DatabaseError('A record with this value already exists.', {
        pgCode: pgError.code,
        constraint: pgError.constraint,
      });
    }
    if (isForeignKeyViolationError(error)) {
      return new DatabaseError('Referenced record does not exist.', {
        pgCode: pgError.code,
        constraint: pgError.constraint,
      });
    }
    return new DatabaseError('A database error occurred.', {
      pgCode: pgError.code,
      message: error.message,
    });
  }
  return new DatabaseError('An unknown database error occurred.');
}
