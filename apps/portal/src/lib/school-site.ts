import { headers } from "next/headers";

import type { SchoolPublicDto } from "@school-kit/types";

import { clientIpHeaders } from "@/lib/client-ip-signature";
import { schoolCodeFromHost } from "@/lib/school-host";

// The school's public pages (docs/modules/school-addresses.md,
// docs/modules/school-website.md), rendered on the server with the visitor's
// signed address so the API's per-family rate limits still apply.

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/** GET a public school-address endpoint; null on 404. */
export async function fetchSchoolSite<T>(path: string): Promise<T | null> {
  const h = await headers();
  const response = await fetch(`${API_BASE}/school-addresses/${path}`, {
    cache: "no-store",
    headers: clientIpHeaders((name) => h.get(name)),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`School page: API answered ${response.status}`);
  return (await response.json()) as T;
}

export function loadSchool(code: string, preview?: string): Promise<SchoolPublicDto | null> {
  const q = preview ? `?preview=${encodeURIComponent(preview)}` : "";
  return fetchSchoolSite<SchoolPublicDto>(`${encodeURIComponent(code)}${q}`);
}

/** Whether the visitor is on the school's own address (so links are short). */
export async function onSchoolAddress(): Promise<boolean> {
  return schoolCodeFromHost((await headers()).get("host")) !== null;
}

/** A link within the school's site, short on its own address. */
export function siteHref(code: string, own: boolean, path: "" | "/news" | "/gallery" | `/news/${string}`): string {
  if (own) return path || "/";
  return `/school/${code}${path}`;
}

export function formatDay(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
}

export function formatDateRange(start: string, end: string): string {
  return start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`;
}

export function formatPublished(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
}
