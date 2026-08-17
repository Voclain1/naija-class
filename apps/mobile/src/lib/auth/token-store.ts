import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { setTokenProvider } from "../api/client";
import { readStoredPrincipal, type Principal } from "./principal";

// Session token storage for apps/mobile.
//
// expo-secure-store puts the value in the iOS Keychain / Android Keystore —
// encrypted at rest and outside the app's own sandboxed files. This is NOT
// AsyncStorage: AsyncStorage is plaintext on disk, readable by anything with
// filesystem access on a rooted/jailbroken device and included in some device
// backups. CLAUDE.md already records localStorage token storage on web as a
// session-takeover risk (docs/deferred.md); AsyncStorage is the same mistake
// wearing a native costume.
//
// Nothing else in the app reads the token directly — the API client receives
// it through the provider installed by initTokenStore(), and the offline query
// cache never contains it (see src/lib/query/client.ts).

const TOKEN_KEY = "sk_session_token";
const PRINCIPAL_KEY = "sk_session_principal";

// Principal parsing lives in ./principal so it can be unit-tested without a
// React Native transform. Re-exported because callers already import the type
// from here alongside the token accessors.
export type { Principal } from "./principal";

/**
 * In-memory mirror of the persisted token.
 *
 * Exists so the API client can read the token SYNCHRONOUSLY. Keychain reads
 * are async native calls; awaiting one per request would put a native
 * round-trip in front of every single API call.
 */
let cachedToken: string | null = null;

/** In-memory mirror of the persisted principal. Same reasoning as above. */
let cachedPrincipal: Principal | null = null;

/**
 * SecureStore is native-only — it is not implemented for react-native-web.
 *
 * The web target exists for `expo export --platform web` and local preview,
 * not as a shipping surface (the real web apps are apps/web and apps/portal).
 * So rather than fall back to localStorage — which would reintroduce exactly
 * the risk this module exists to avoid — the web build keeps the token in
 * memory only. Consequence: a page reload on web signs you out. That is the
 * correct trade for a preview target, and it fails safe.
 */
const isSecureStoreAvailable = Platform.OS !== "web";

export async function loadPersistedToken(): Promise<string | null> {
  if (!isSecureStoreAvailable) return cachedToken;
  try {
    cachedToken = await SecureStore.getItemAsync(TOKEN_KEY);
    // A token written before the student principal existed has no principal
    // key beside it. Guardian was the only principal then, so that is what it
    // must be — read as null it would strand an already-signed-in parent on a
    // screen the router cannot resolve.
    cachedPrincipal = cachedToken
      ? readStoredPrincipal(await SecureStore.getItemAsync(PRINCIPAL_KEY))
      : null;
  } catch {
    // A corrupted keychain entry must not brick the app on launch. Treat it
    // as "no session" — the user signs in again and the entry is rewritten.
    cachedToken = null;
    cachedPrincipal = null;
  }
  return cachedToken;
}

export async function saveToken(
  token: string,
  principal: Principal,
): Promise<void> {
  cachedToken = token;
  cachedPrincipal = principal;
  if (!isSecureStoreAvailable) return;
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(PRINCIPAL_KEY, principal);
}

export async function clearToken(): Promise<void> {
  cachedToken = null;
  cachedPrincipal = null;
  if (!isSecureStoreAvailable) return;
  for (const key of [TOKEN_KEY, PRINCIPAL_KEY]) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Deleting a key that is already absent throws on some platforms. The
      // in-memory copies are cleared above, which is what governs
      // authorization — and the loop must not abandon the second key because
      // the first threw.
    }
  }
}

export function getCachedToken(): string | null {
  return cachedToken;
}

export function getCachedPrincipal(): Principal | null {
  return cachedPrincipal;
}

/**
 * How long boot will wait for the keychain before giving up.
 *
 * A native keychain read is normally single-digit milliseconds, but it is an
 * IPC call to a system service and CAN wedge — a locked keychain, a device
 * mid-restore, a vendor-specific Keystore bug. The app holds the splash screen
 * until this resolves, so a hang with no ceiling is indistinguishable from a
 * crash: the user stares at a logo forever and force-quits.
 *
 * Timing out means we boot as signed-out. That is a recoverable annoyance
 * (sign in again) rather than an unrecoverable one (app appears broken).
 */
const HYDRATE_TIMEOUT_MS = 3000;

/**
 * Wire the token store into the API client and hydrate from secure storage.
 * Call once, at app boot, before the first request.
 *
 * Hydration MUST complete before the first authenticated request: rendering
 * the app with no token yet loaded would fire unauthenticated calls, get 401s,
 * and bounce a user who has a perfectly valid session straight to login.
 *
 * Never rejects — boot must not depend on the keychain succeeding.
 */
export async function initTokenStore(): Promise<void> {
  setTokenProvider(getCachedToken);

  await Promise.race([
    loadPersistedToken().catch(() => null),
    new Promise((resolve) => setTimeout(resolve, HYDRATE_TIMEOUT_MS)),
  ]);
}
