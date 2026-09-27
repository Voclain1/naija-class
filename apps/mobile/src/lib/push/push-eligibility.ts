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
 * **`canAskAgain` is the signal, not the status.** This function used to test
 * `status === "undetermined"`, which meant no Android 13+ device was EVER
 * prompted — every one of them silently ended up with push off. Found by
 * installing the APK on Android 16 and getting no prompt (2026-09-25).
 *
 * The reason is in expo-notifications' own Android source
 * (`NotificationPermissionsModule.kt`): on API 33+ it resolves the status as
 * DENIED whenever `areNotificationsEnabled()` is false — which is the case on
 * a fresh install where the user has never been asked. It returns
 * "undetermined" only in a mixed state that a single-permission app like ours
 * never reaches. So "denied" on Android means BOTH "never asked" and
 * "refused", and `canAskAgain` is the only thing that tells them apart.
 *
 * The original intent still holds and is now expressed correctly: never
 * re-ask after a real denial. A second request then shows no prompt and
 * returns denied immediately, so re-asking is a no-op that cannot change the
 * answer — the user has to go to Settings, which is the OS's decision and not
 * ours to route around. `canAskAgain: false` is exactly that state.
 */
export function shouldRequestPermission(input: {
  status: PermissionStatus;
  canAskAgain: boolean;
}): boolean {
  if (input.status === "granted") return false;
  return input.canAskAgain;
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

/**
 * Whether to attempt registration for the session as it stands.
 *
 * This exists because the seam it guards has now produced TWO production bugs,
 * and neither was reachable from a test:
 *
 *  1. `shouldRequestPermission` never asked on Android 13+, so no device ever
 *     had permission (fixed 2026-09-25).
 *  2. `registerForPush` was called only inside the three sign-in functions, so
 *     a RESTORED session never registered at all. Everyone already signed in
 *     when they installed the fixed build still had no token, and production
 *     logged `push=true, tokens=0` while the school's push setting was on and
 *     the event itself fired correctly (found on a device 2026-09-27).
 *
 * `registerForPush` has always documented itself as safe to call on every cold
 * start — it POSTs only when the token or principal changed. Nothing called it
 * that way. This function is the rule, so the wiring has something to assert
 * against.
 *
 * "locked" deliberately returns false: a staff session behind the lock screen
 * has no usable bearer token, so the POST would 401 and the silent catch would
 * swallow it. Registration happens again when they unlock, which flips status
 * back to "authenticated".
 */
export function shouldRegisterOnLaunch(session: {
  /** The full SessionStatus union, "loading" included — see below. */
  status: "loading" | "guest" | "authenticated" | "locked";
  principal: string | null;
}): boolean {
  // Written as an explicit test for "authenticated" rather than as a list of
  // statuses to skip: a status added later (a future "expired", say) then
  // defaults to NOT registering, which is the safe direction. "loading" is one
  // of these — the session has not resolved, and there may be no token yet.
  return session.status === "authenticated" && session.principal !== null;
}
