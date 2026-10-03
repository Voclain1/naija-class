import { ApiError } from "../api/client";

/**
 * True when a result read failed ONLY because the term was released behind
 * result PINs and is not yet unlocked (Phase 8c / CP6b) — the one failure the
 * result screens answer with a PIN box rather than an error.
 */
export function isResultLocked(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.code === "RESULT_LOCKED";
}
