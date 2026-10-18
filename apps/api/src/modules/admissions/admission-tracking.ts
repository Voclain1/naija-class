import { createHmac } from "node:crypto";

import { resolveResultPinKey } from "../result-checker/result-pin-key.js";
import { hashToken } from "./admissions.shared.js";

// Phase 9 / CP7.2 — the family's private tracking link (docs/modules/
// phase-9.md §16.8 answer 3): EVERY email carries it, not only the first.
//
// The database keeps only the link's sha256 (CP7.1), so the link cannot be
// read back. Instead the token is DERIVED: an HMAC of the application's id
// under a server key, so the API can rebuild it for each status email while a
// stolen database still holds no working link. The key is the result-checker
// key (RESULT_PIN_HMAC_KEY, which production refuses to start without), under
// a label of its own so the two uses never produce the same value.
//
// Rotating that key ends every tracking link, as it voids PINs. A rebuilt
// token that no longer matches the stored hash is simply left out of the
// email, which then points the family to their first email instead.

const LABEL = "admission-tracking:v1:";

export function admissionTrackingToken(applicationId: string, key: string = resolveResultPinKey()): string {
  return createHmac("sha256", key).update(LABEL + applicationId).digest("base64url");
}

/** The family's link for this application, or null if it can no longer be rebuilt. */
export function rebuildTrackingToken(applicationId: string, storedHash: string): string | null {
  const token = admissionTrackingToken(applicationId);
  return hashToken(token) === storedHash ? token : null;
}
