// The staff app's base path (docs/modules/school-hosted-apps.md).
//
// The staff app is served at /staff: at app.schoolkit.ng/staff, and at each
// school's own address, <code>.schoolkit.ng/staff, where the portal forwards
// /staff to this app (Next.js multi-zones). next.config.mjs sets the base
// path and passes it here as NEXT_PUBLIC_BASE_PATH.
//
// Next adds the base path itself to <Link>, the router and next/navigation's
// redirect. Everything else that names a path of this app does not, and goes
// through withBasePath: fetch to our own /api routes, window.location, plain
// <a> and <img> to files in public/, and next/image's src.

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** "/api/auth/login" → "/staff/api/auth/login". Leaves anything but an internal path alone. */
export function withBasePath(path: string): string {
  if (!BASE_PATH || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`) || path.startsWith(`${BASE_PATH}?`)) return path;
  return `${BASE_PATH}${path === "/" ? "" : path}`;
}

/** window.location.pathname without the base path, for the router and ?next=. */
export function stripBasePath(path: string): string {
  if (!BASE_PATH) return path;
  if (path === BASE_PATH) return "/";
  return path.startsWith(`${BASE_PATH}/`) ? path.slice(BASE_PATH.length) : path;
}
