// School slugs become subdomains: <slug>.schoolkit.ng. Some names collide
// with our own routes (admin, api), some are likely to be system-owned
// subdomains later (cdn, assets, mail). Reserve them now so we don't have to
// migrate squatters off later.
//
// Lowercase only — slug is normalized to lowercase before this check.

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // app + infra namespaces
  "admin",
  "api",
  "app",
  "auth",
  "assets",
  "cdn",
  "console",
  "dashboard",
  "static",
  "support",
  "www",
  // auth-flow paths
  "login",
  "logout",
  "signup",
  "register",
  "verify",
  "invitations",
  "invite",
  "onboarding",
  // marketing / corporate
  "about",
  "blog",
  "careers",
  "contact",
  "docs",
  "help",
  "home",
  "pricing",
  "privacy",
  "terms",
  // common system prefixes
  "billing",
  "mail",
  "ns",
  "ns1",
  "ns2",
  "smtp",
  "status",
  "test",
  "schoolkit",
  "school-kit",
]);
