import { createHmac } from "node:crypto";

import { RESULT_PIN_DIGITS } from "@school-kit/types";

// The server secret result PINs are hashed under (D56,
// docs/modules/phase-8.md §21.0).
//
// A 12-digit PIN space (10^12) is brute-forceable from a plain SHA-256 in
// hours, so a stolen database would hand over every unredeemed card. Keyed,
// the database alone reveals nothing.
//
// PRODUCTION REFUSES TO START WITHOUT IT. A config key added to the repo but
// never set on Fly is this project's known failure mode (CLAUDE.md, the
// PORTAL_BASE_URL incident): there, links quietly pointed at localhost for
// days. Here the quiet failure would be worse — PINs hashed under a guessable
// default. A deploy that cannot start is loud, and the staging deploy's smoke
// test rolls it back.
//
// Rotating the key voids every unredeemed PIN (their hashes no longer match).
// Recorded in D56, not engineered around: there is no reason to rotate it
// short of a leak, and after a leak voiding them is the point.

export const RESULT_PIN_KEY = Symbol("RESULT_PIN_KEY");

/** Dev and test only. Never used when NODE_ENV is production. */
const NON_PRODUCTION_KEY = "school-kit-dev-result-pin-key-not-for-production";

export function resolveResultPinKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.RESULT_PIN_HMAC_KEY?.trim();
  if (key) {
    if (key.length < 32) {
      throw new Error("RESULT_PIN_HMAC_KEY must be at least 32 characters (use `openssl rand -hex 32`).");
    }
    return key;
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      "RESULT_PIN_HMAC_KEY is not set. Result Checker PINs cannot be hashed safely without it. " +
        "Set it on the API app (flyctl secrets set RESULT_PIN_HMAC_KEY=$(openssl rand -hex 32) -a school-kit-api).",
    );
  }
  return NON_PRODUCTION_KEY;
}

/** The PIN's digits, or null if it is not a well-formed 12-digit PIN. */
export function normalisePin(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return new RegExp(`^\\d{${RESULT_PIN_DIGITS}}$`).test(digits) ? digits : null;
}

export function hashPin(key: string, digits: string): string {
  return createHmac("sha256", key).update(digits).digest("hex");
}

/** "482109375512" → "4821 0937 5512", the printed form. */
export function formatPin(digits: string): string {
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}
