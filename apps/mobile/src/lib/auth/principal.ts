// Which kind of account a stored session token belongs to.
//
// Deliberately its own module, with NO react-native or expo-secure-store
// imports, so the parsing rule below is unit-testable. apps/mobile's Vitest
// runs in a node environment with no React Native transform (see
// vitest.config.ts), so anything importing `react-native` cannot be reached
// from a spec — and this rule is the part with a wrong answer worth guarding.

export type Principal = "guardian" | "student";

/**
 * Narrow an untrusted value read out of secure storage.
 *
 * Defaults to "guardian" rather than returning null, and that default is
 * load-bearing rather than lazy: a token written before the student principal
 * existed has no principal key stored beside it. Guardian was the only
 * principal that could have written it, so that is what it is. Treating the
 * absent key as "unknown" would strand an already-signed-in parent — the
 * router would have a session but no surface to send it to.
 *
 * Anything unrecognised (a corrupted entry, a value from a future version)
 * also reads as guardian: the guardian surface is the narrower mistake. A
 * parent wrongly shown the student surface would hit a student endpoint with
 * a guardian token and be signed out by the 401 handler; the reverse merely
 * shows a "no children linked" list.
 */
export function readStoredPrincipal(raw: string | null | undefined): Principal {
  return raw === "student" ? "student" : "guardian";
}
