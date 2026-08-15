import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { setTokenProvider } from "../api/client";

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

/**
 * In-memory mirror of the persisted token.
 *
 * Exists so the API client can read the token SYNCHRONOUSLY. Keychain reads
 * are async native calls; awaiting one per request would put a native
 * round-trip in front of every single API call.
 */
let cachedToken: string | null = null;

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
  } catch {
    // A corrupted keychain entry must not brick the app on launch. Treat it
    // as "no session" — the user signs in again and the entry is rewritten.
    cachedToken = null;
  }
  return cachedToken;
}

export async function saveToken(token: string): Promise<void> {
  cachedToken = token;
  if (!isSecureStoreAvailable) return;
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  cachedToken = null;
  if (!isSecureStoreAvailable) return;
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Deleting a key that is already absent throws on some platforms. The
    // in-memory copy is cleared above, which is what governs authorization.
  }
}

export function getCachedToken(): string | null {
  return cachedToken;
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
