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

// 400. Two constructor shapes — same idea as UnauthorizedError. Existing
// call sites all use the one-arg `(message, details?)` form, where the
// `code` falls back to "VALIDATION_ERROR" and the message is the human-
// readable line. Newer call sites that need a stable sub-code (CSV
// import emits INVALID_CSV / AMBIGUOUS_HEADERS so the wizard can branch
// without parsing strings) pass `(code, message, details?)` with the
// second arg being a string. The string-type-of-second-arg disambiguates
// the two — `details` is always an object in legacy calls.
export class ValidationError extends BaseError {
  readonly httpStatus = 400;
  readonly code: string;
  constructor(
    codeOrMessage: string,
    messageOrDetails?: string | unknown,
    details?: unknown,
  ) {
    if (typeof messageOrDetails === "string") {
      super(messageOrDetails, details);
      this.code = codeOrMessage;
    } else {
      super(codeOrMessage, messageOrDetails);
      this.code = "VALIDATION_ERROR";
    }
  }
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

// 410 — the resource existed but is no longer available. Used by the public
// invitation endpoints to distinguish "this invitation has expired" /
// "this invitation has already been used" from a plain 404 (no such token).
// 409 ConflictError would be wrong: the state isn't conflicting with the
// caller's request, the resource is genuinely gone. Sub-code present in the
// same shape as ConflictError so the client can branch on
// INVITATION_EXPIRED vs INVITATION_ALREADY_ACCEPTED without parsing
// the message.
export class GoneError extends BaseError {
  readonly httpStatus = 410;
  readonly code: string;
  constructor(code: string, message: string, details?: unknown) {
    super(message, details);
    this.code = code;
  }
}

// 413 — the request entity is larger than the server is willing or able to
// process. CSV upload uses this for both FILE_TOO_LARGE (Multer rejects on
// the 5 MB cap) and TOO_MANY_ROWS (>10 000 data rows; we count synchronously
// before persisting to storage). Sub-code carried in the same shape as
// ConflictError so the client can branch without parsing the message.
export class PayloadTooLargeError extends BaseError {
  readonly httpStatus = 413;
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
