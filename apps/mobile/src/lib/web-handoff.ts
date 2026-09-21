// CP4 D36 — sending an administrator to the website for the jobs that stay
// there (school settings, staff and roles, payroll, refunds, bulk imports).
//
// A PLAIN LINK, by decision: automatic sign-in needs a one-time login token,
// which is a security-sensitive server change with its own plan still to come.
// If the admin's browser session has lapsed, they sign in on the website.
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
