// Turning an API error envelope into text a person can act on.
//
// WHY THIS EXISTS. Both the API's validation entry points — ZodValidationPipe
// and schools.controller.ts's parseStepPayload — throw
// `ValidationError("Invalid request payload", formatZodIssues(err))`. The
// message is a constant; everything specific lives in `details.issues[]`:
//
//   { code: "VALIDATION_ERROR",
//     message: "Invalid request payload",
//     details: { issues: [
//       { path: "calendar.terms.0", code: "custom",
//         message: "First Term must fall within the academic year." } ] } }
//
// Call sites that render `err.message` therefore show the constant and drop
// the sentence that would have told the user what to fix. That is exactly
// what blocked a real school at onboarding step 5 on 2026-09-11: the owner
// changed their academic year's dates, the pre-filled term dates fell outside
// the new range, and the only thing the screen said was "Invalid request
// payload". The server had computed "First Term must fall within the academic
// year." and the UI threw it away.
//
// Kept free of any `ApiError` import on purpose: it takes the envelope
// structurally, so it stays a pure module that apps/web's node-environment
// Vitest runner can cover. Callers do the `instanceof ApiError` narrowing.

/** One entry of the API's `details.issues[]`. */
export interface ApiValidationIssue {
  /** Dot-joined Zod path, e.g. "calendar.terms.0" or "yearEndDate". */
  path: string;
  code: string;
  message: string;
}

/** The subset of an ApiError this module needs. */
export interface ApiErrorEnvelope {
  message: string;
  details?: unknown;
}

function isIssue(value: unknown): value is ApiValidationIssue {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.path === "string" &&
    typeof v.code === "string" &&
    typeof v.message === "string" &&
    v.message.trim().length > 0
  );
}

/**
 * Pulls `details.issues[]` out of an error envelope. Returns [] for any shape
 * that isn't the validation envelope — a 500, a NotFoundError, a details blob
 * from some other endpoint — so callers can fall back cleanly.
 */
export function extractValidationIssues(details: unknown): ApiValidationIssue[] {
  if (typeof details !== "object" || details === null) return [];
  const issues = (details as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues.filter(isIssue);
}

/**
 * The lines to show the user for a failed request. Never empty, and never the
 * generic envelope message when something more specific is available.
 *
 * - `error === null` (a network failure, not an API response) → [fallback]
 * - the envelope carries issues → one line per issue, in server order
 * - otherwise → the envelope's own message, which for every non-validation
 *   error is already the specific one (e.g. "Session is invalid or has been
 *   revoked.")
 */
export function apiErrorLines(error: ApiErrorEnvelope | null, fallback: string): string[] {
  if (!error) return [fallback];
  const issues = extractValidationIssues(error.details);
  if (issues.length > 0) return issues.map((i) => i.message);
  return [error.message];
}
