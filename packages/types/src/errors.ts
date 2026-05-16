// Domain error classes. The whole API returns errors in this shape:
//   { error: { code: string, message: string, details?: unknown } }
//
// Throw a subclass of BaseError from anywhere in the request path and the
// global HttpExceptionFilter (apps/api/src/common/http-exception.filter.ts)
// serializes it correctly with the matching HTTP status. Unknown errors are
// mapped to INTERNAL_ERROR (500) and logged.

export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ErrorResponse {
  error: ErrorBody;
}

export abstract class BaseError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }

  toBody(): ErrorBody {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export class ValidationError extends BaseError {
  readonly code = "VALIDATION_ERROR";
  readonly httpStatus = 400;
}

// Like ConflictError, UnauthorizedError carries an optional sub-code so the
// client can distinguish between (e.g.) MISSING_BEARER_TOKEN, INVALID_SESSION,
// SESSION_EXPIRED, USER_INACTIVE, and INVALID_CREDENTIALS without parsing
// the human-readable message. Default is the generic "UNAUTHORIZED".
export class UnauthorizedError extends BaseError {
  readonly httpStatus = 401;
  readonly code: string;
  constructor(codeOrMessage: string, message?: string, details?: unknown) {
    // Two-arg form: (subCode, message). One-arg form: just the message,
    // code defaults to "UNAUTHORIZED" (back-compat).
    if (message === undefined) {
      super(codeOrMessage, details);
      this.code = "UNAUTHORIZED";
    } else {
      super(message, details);
      this.code = codeOrMessage;
    }
  }
}

export class ForbiddenError extends BaseError {
  readonly code = "FORBIDDEN";
  readonly httpStatus = 403;
}

export class NotFoundError extends BaseError {
  readonly code = "NOT_FOUND";
  readonly httpStatus = 404;
}

// ConflictError carries a sub-code (e.g. SCHOOL_SLUG_TAKEN) so the client
// can branch on the specific conflict without parsing the message.
export class ConflictError extends BaseError {
  readonly httpStatus = 409;
  readonly code: string;
  constructor(code: string, message: string, details?: unknown) {
    super(message, details);
    this.code = code;
  }
}

export class InternalError extends BaseError {
  readonly code = "INTERNAL_ERROR";
  readonly httpStatus = 500;
}
