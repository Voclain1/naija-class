// Decisions about whether to ask for a push token, and what to do with the
// answer. Its own react-native-free module, matching ./auth/principal and
// ./auth/school-hint — apps/mobile's Vitest runs node-env with no React
// Native transform, so anything importing expo-notifications is unreachable
// from a spec. The platform calls live in ./register.

/** What the OS says about notification permission. */
export type PermissionStatus = "granted" | "denied" | "undetermined";

/**
 * Whether to ask the OS for permission.
 *
 * NEVER re-ask after a denial. On both platforms a second request after
 * "denied" does not show a prompt — it returns denied immediately — so
 * re-asking is not merely rude, it is a no-op that costs a native round trip
 * on every launch and can never change the answer. The user has to go to
 * Settings, which is the OS's decision, not ours to route around.
 */
export function shouldRequestPermission(current: PermissionStatus): boolean {
  return current === "undetermined";
}

/**
 * Whether a token may be requested at all.
 *
 * Two independent gates, and both matter:
 *
 *   - permission must be granted — asking Expo for a token without it throws
 *     on iOS and returns nothing useful on Android;
 *   - it must be a real device. Push is not deliverable to a simulator
 *     without Google Play services, and attempting it produces a confusing
 *     error rather than a clean "not supported".
 */
export function canRequestToken(input: {
  permission: PermissionStatus;
  isDevice: boolean;
}): boolean {
  return input.permission === "granted" && input.isDevice;
}

/**
 * Whether a freshly-read token needs to be sent to the server.
 *
 * Expo hands back the same token on every launch for the life of an install,
 * so POSTing it unconditionally would mean one write per app open, per user,
 * forever — for a value that almost never changes. Sending only on change
 * makes registration effectively free after the first launch.
 *
 * The principal is part of the comparison, not just the token: on a shared
 * family handset the same device token legitimately moves from a parent to a
 * child, and the SERVER must be told, because the row has to be reassigned
 * or the child's notifications would keep going to the parent's account.
 */
export function needsRegistration(input: {
  token: string;
  principal: string;
  lastRegisteredToken: string | null;
  lastRegisteredPrincipal: string | null;
}): boolean {
  return (
    input.token !== input.lastRegisteredToken ||
    input.principal !== input.lastRegisteredPrincipal
  );
}
