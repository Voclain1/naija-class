// Deploy-time check for the staff session cookie (docs/deferred.md item 1).
//
// The web app no longer holds the session token: the browser sends the
// sk_session cookie straight to the API. In production that only works when
//   - SESSION_COOKIE_DOMAIN is set (e.g. "schoolkit.ng"), and
//   - NEXT_PUBLIC_API_URL is an https address under that domain
//     (e.g. https://api.schoolkit.ng/api/v1).
// Otherwise the API never receives the cookie and every member of staff is
// signed out on their next click. That must fail the deploy, which leaves the
// previous version live, rather than ship. CLAUDE.md records the same lesson
// twice (PORTAL_BASE_URL, NEXT_PUBLIC_API_URL): config that is never checked
// against the deployed environment fails silently.
//
// Returns null when the configuration is usable, else the reason.

/** @param {Record<string, string | undefined>} env */
export function sessionCookieConfigProblem(env) {
  if (env.VERCEL_ENV !== "production") return null;

  const domain = (env.SESSION_COOKIE_DOMAIN ?? "").trim().replace(/^\./, "");
  if (!domain) {
    return "SESSION_COOKIE_DOMAIN is not set. Set it to the domain shared by the web app and the API (schoolkit.ng).";
  }

  /** @type {URL} */
  let api;
  try {
    api = new URL(env.NEXT_PUBLIC_API_URL ?? "");
  } catch {
    return "NEXT_PUBLIC_API_URL is not a valid URL. Set it to https://api.schoolkit.ng/api/v1.";
  }
  const under = (host) => host === domain || host.endsWith(`.${domain}`);
  if (api.protocol !== "https:" || !under(api.hostname)) {
    return `NEXT_PUBLIC_API_URL (${api.origin}) must be an https address under ${domain}, or the browser will not send it the session cookie.`;
  }

  const site = (env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim();
  if (site && !under(site.replace(/^https?:\/\//, "").split("/")[0])) {
    return `The web app's production address (${site}) is not under SESSION_COOKIE_DOMAIN (${domain}).`;
  }
  return null;
}
