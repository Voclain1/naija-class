"use client";

import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";

import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { getSchoolLogoUrl } from "@/lib/onboarding/schools-api";

// The signed display URL lives an hour (CLAUDE.md, "Real logo upload"). The
// sidebar, topbar and drawer each mount a SchoolLogo, so share one fetch per
// stored logo path and refresh well inside the hour.
const SIGNED_URL_REUSE_MS = 45 * 60 * 1000;
const signedUrlCache = new Map<string, { at: number; promise: Promise<string | null> }>();

// A re-upload can keep the same storage path (same extension), so the path
// alone cannot tell a mounted logo that the image changed. The upload calls
// forgetSchoolLogoUrl(), which drops the cache and bumps this version.
let logoVersion = 0;
const logoVersionListeners = new Set<() => void>();

export function forgetSchoolLogoUrl(): void {
  signedUrlCache.clear();
  logoVersion += 1;
  for (const listener of logoVersionListeners) listener();
}

function subscribeLogoVersion(listener: () => void): () => void {
  logoVersionListeners.add(listener);
  return () => logoVersionListeners.delete(listener);
}

function signedLogoUrl(logoPath: string): Promise<string | null> {
  const hit = signedUrlCache.get(logoPath);
  if (hit && Date.now() - hit.at < SIGNED_URL_REUSE_MS) return hit.promise;
  const promise = getSchoolLogoUrl()
    .then((res) => res.url)
    .catch((e) => {
      // 404 (no logo yet) is expected and not an error to surface —
      // anything else is logged but still just falls back to no image.
      if (!(e instanceof ApiError && e.status === 404)) {
        console.error("[SchoolLogo] getSchoolLogoUrl:", e);
      }
      signedUrlCache.delete(logoPath);
      return null;
    });
  signedUrlCache.set(logoPath, { at: Date.now(), promise });
  return promise;
}

// Displays the school's uploaded logo, or `fallback` (default: nothing) if
// none has been uploaded. Re-fetches the signed display URL whenever
// `school.logoUrl` (the canonical-path presence flag on the auth context)
// changes — e.g. right after a fresh upload calls setSchool().
export function SchoolLogo({ className, fallback = null }: { className?: string; fallback?: ReactNode }) {
  const { school } = useAuth();
  const version = useSyncExternalStore(subscribeLogoVersion, () => logoVersion, () => 0);
  const [state, setState] = useState<{ key: string; url: string | null } | null>(null);
  const logoPath = school?.logoUrl ?? null;
  const key = `${logoPath}#${version}`;

  useEffect(() => {
    let cancelled = false;
    if (!logoPath) {
      setState(null);
      return;
    }
    signedLogoUrl(logoPath).then((url) => {
      if (!cancelled) setState({ key, url });
    });
    return () => {
      cancelled = true;
    };
  }, [logoPath, key]);

  if (!logoPath) return <>{fallback}</>;
  // Still fetching the signed URL for this path: render nothing rather than
  // flash the fallback before the logo arrives.
  if (state?.key !== key) return null;
  if (!state.url) return <>{fallback}</>;

  // External, signed, per-tenant URL that changes host between the dev
  // filesystem proxy and R2 in prod — next/image's domain allowlist doesn't
  // fit that, so a plain <img> is the right call here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={state.url} alt={school?.name ? `${school.name} logo` : "School logo"} className={className} />;
}
