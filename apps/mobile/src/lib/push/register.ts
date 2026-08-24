import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { RegisterDeviceInput } from "@school-kit/types";

import { apiFetch } from "../api/client";
import type { Principal } from "../auth/principal";

type PushPrincipal = Exclude<Principal, "staff">;
import {
  canRequestToken,
  needsRegistration,
  shouldRequestPermission,
  type PermissionStatus,
} from "./push-eligibility";

// Phase 6 / Slice 5 — obtaining an Expo push token and handing it to the API.
//
// The decisions live in ./push-eligibility so they can be unit-tested; this
// file is the platform seam and is deliberately thin.
//
// WHY THIS IS FIRE-AND-FORGET. Registration failing must never block or fail
// a sign-in. A parent who cannot receive push notifications can still use
// every screen in the app; a parent who cannot sign in cannot use any of
// them. So every path here swallows its error after logging, exactly like
// wakeRenderWorker on the API side and for the same reason.

const LAST_TOKEN_KEY = "sk_push_last_token";
const LAST_PRINCIPAL_KEY = "sk_push_last_principal";

/** Where the guardian and student surfaces each accept a device. */
function endpointFor(principal: PushPrincipal): string {
  return principal === "student" ? "/student-portal/devices" : "/portal/devices";
}

function currentPlatform(): RegisterDeviceInput["platform"] | null {
  if (Platform.OS === "android") return "ANDROID";
  if (Platform.OS === "ios") return "IOS";
  // web, and anything else. There is no push on the web preview target, and
  // returning null here is what keeps this whole module inert there rather
  // than throwing on a missing native module.
  return null;
}

/**
 * The EAS project id, which getExpoPushTokenAsync requires in a build.
 *
 * Read from the config rather than hardcoded: it is already committed in
 * app.json (`extra.eas.projectId`), and two copies of an identifier is how
 * they drift.
 */
function projectId(): string | undefined {
  const fromExtra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  return fromExtra?.eas?.projectId;
}

/**
 * Ask for permission if we have never asked, and report where we stand.
 *
 * Deliberately does NOT prompt on every launch — see shouldRequestPermission.
 */
async function resolvePermission(): Promise<PermissionStatus> {
  const existing = await Notifications.getPermissionsAsync();
  const current = existing.status as PermissionStatus;
  if (!shouldRequestPermission(current)) return current;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.status as PermissionStatus;
}

/**
 * Register this device for push, for the principal who just signed in.
 *
 * Safe to call on every sign-in and every cold start: it POSTs only when the
 * token or the principal has actually changed (needsRegistration), so the
 * steady-state cost after first launch is two AsyncStorage reads.
 */
export async function registerForPush(principal: PushPrincipal): Promise<void> {
  try {
    const platform = currentPlatform();
    if (platform === null) return;

    const permission = await resolvePermission();
    if (!canRequestToken({ permission, isDevice: Device.isDevice })) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: projectId(),
    });

    const [lastToken, lastPrincipal] = await Promise.all([
      AsyncStorage.getItem(LAST_TOKEN_KEY),
      AsyncStorage.getItem(LAST_PRINCIPAL_KEY),
    ]);

    if (
      !needsRegistration({
        token,
        principal,
        lastRegisteredToken: lastToken,
        lastRegisteredPrincipal: lastPrincipal,
      })
    ) {
      return;
    }

    const body: RegisterDeviceInput = { expoPushToken: token, platform };
    await apiFetch(endpointFor(principal), { method: "POST", body });

    // Recorded only AFTER the server accepted it. Writing first would mean a
    // failed POST is never retried, because the next launch would see the
    // token as already registered and skip it — the device would then be
    // permanently unreachable by push while looking fine.
    await AsyncStorage.multiSet([
      [LAST_TOKEN_KEY, token],
      [LAST_PRINCIPAL_KEY, principal],
    ]);
  } catch {
    // Intentionally silent to the user. Push is an enhancement; a parent
    // whose registration failed still gets SMS, which is exactly the
    // fallback D37 describes.
  }
}

/**
 * Release this device on sign-out (D40).
 *
 * Best-effort, and the local record is cleared even if the DELETE fails: the
 * next sign-in must re-register rather than believe a stale token is still
 * claimed. The server tolerates deleting a token that is already gone.
 */
export async function unregisterForPush(principal: PushPrincipal): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(LAST_TOKEN_KEY);
    if (token) {
      await apiFetch(`${endpointFor(principal)}/${encodeURIComponent(token)}`, {
        method: "DELETE",
      });
    }
  } catch {
    // Sign-out must succeed regardless. A token left registered server-side
    // is corrected by the receipt prune once the app stops being reachable,
    // and by the next sign-in's re-registration before that.
  } finally {
    await AsyncStorage.multiRemove([LAST_TOKEN_KEY, LAST_PRINCIPAL_KEY]).catch(() => {});
  }
}
