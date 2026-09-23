// CP4 D36 — sending an administrator to the website for the jobs that stay
// there (school settings, staff and roles, payroll, refunds, bulk imports).
//
// SIGNED IN AUTOMATICALLY, since 2026-09-23 (docs/modules/web-handoff-signin.md):
// the app asks the API for a single-use, 60-second token and opens
// /handoff?t=…&next=…, which the website trades for its own session cookie.
// The app's session token NEVER travels in the URL — that is how credentials
// end up in browser history, referrer headers and server logs.
//
// It degrades to the plain link it used to be: if minting fails for any
// reason, the admin lands on the same page and signs in. A handoff is never
// worse than before.
//
// The address is build-time config (`EXPO_PUBLIC_WEB_URL`, set per profile in
// eas.json and pinned by app-config.spec.ts). There is deliberately NO
// fallback: this codebase has shipped "config in the repo, never set on the
// real environment" four times, and a fallback to localhost would turn the
// fifth into a button that silently opens nothing on a head teacher's phone.
// A missing value is reported as unconfigured instead.

/** The configured website origin, without a trailing slash, or null. */
export function webOrigin(raw: string | undefined = process.env.EXPO_PUBLIC_WEB_URL): string | null {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (value === "") return null;
  // Only an absolute http(s) origin is acceptable; anything else is config
  // that would open somewhere unexpected.
  if (!/^https?:\/\/[^/\s]+$/i.test(value)) return null;
  return value;
}

/**
 * An absolute website URL for an app path such as "/settings", or null when
 * the website address is not configured in this build.
 */
export function webUrl(path: string, origin: string | null = webOrigin()): string | null {
  if (origin === null) return null;
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${clean}`;
}

export const WEB_NOT_CONFIGURED_MESSAGE =
  "The website link isn't set up in this version of the app. Open the School Kit website in your browser instead.";

/**
 * The URL to open for a website path, signed in when possible.
 *
 * Never throws and never blocks on failure: a minting error, an expired app
 * session or an offline phone all fall back to the plain link.
 */
export async function signedInWebUrl(
  path: string,
  mint: (next: string) => Promise<{ token: string }>,
  origin: string | null = webOrigin(),
): Promise<string | null> {
  const plain = webUrl(path, origin);
  if (plain === null) return null;
  const next = path.startsWith("/") ? path : `/${path}`;
  try {
    const { token } = await mint(next);
    if (!token) return plain;
    return `${origin}/handoff?t=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
  } catch {
    return plain;
  }
}
