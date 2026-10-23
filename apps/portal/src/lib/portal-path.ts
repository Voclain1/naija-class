"use client";

import { useEffect, useState } from "react";

import { schoolCodeFromHost } from "./school-host";

// Parents at their school's own address (docs/modules/school-hosted-apps.md).
//
// On portal.schoolkit.ng the parents' pages sit at the root, as always. On a
// school's address ("<code>.schoolkit.ng") the root is the school's front page,
// so the same pages sit under /parents, rewritten by middleware.ts. Every
// internal link and redirect in the parents' pages goes through portalPath(),
// so one set of pages serves both places.
//
// There is no per-request basePath in Next.js, so the prefix is read from the
// browser's address. Server rendering does not know it; usePortalPrefix()
// starts at "" and corrects itself on mount, and middleware redirects any
// unprefixed parents' path on a school's address, so a link followed in that
// moment still lands in the right place.

export const PARENTS_PREFIX = "/parents";

/** The school code of the address this page is open at, or null. Browser only. */
export function schoolCodeHere(): string | null {
  return typeof window === "undefined" ? null : schoolCodeFromHost(window.location.host);
}

/** "/parents" at a school's address, "" elsewhere. Browser only. */
export function portalPrefix(): string {
  return schoolCodeHere() ? PARENTS_PREFIX : "";
}

/** A parents' page path ("/students/x") as it is reached from here. */
export function withPrefix(prefix: string, path: string): string {
  if (!prefix || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)) return path;
  if (path === "/") return prefix;
  if (path.startsWith("/?") || path.startsWith("/#")) return `${prefix}${path.slice(1)}`;
  return `${prefix}${path}`;
}

export function portalPath(path: string): string {
  return withPrefix(portalPrefix(), path);
}

export function usePortalPrefix(): string {
  const [prefix, setPrefix] = useState("");
  useEffect(() => setPrefix(portalPrefix()), []);
  return prefix;
}
