"use client";

import { useEffect, useState } from "react";

import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { getSchoolLogoUrl } from "@/lib/onboarding/schools-api";

// Displays the school's uploaded logo, or nothing (caller decides the
// fallback) if none has been uploaded. Re-fetches the signed display URL
// whenever `school.logoUrl` (the canonical-path presence flag on the auth
// context) changes — e.g. right after a fresh upload calls setSchool().
export function SchoolLogo({ className }: { className?: string }) {
  const { school } = useAuth();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!school?.logoUrl) {
      setUrl(null);
      return;
    }
    getSchoolLogoUrl()
      .then((res) => {
        if (!cancelled) setUrl(res.url);
      })
      .catch((e) => {
        // 404 (no logo yet) is expected and not an error to surface —
        // anything else is logged but still just falls back to no image.
        if (!(e instanceof ApiError && e.status === 404)) {
          console.error("[SchoolLogo] getSchoolLogoUrl:", e);
        }
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [school?.logoUrl]);

  if (!url) return null;

  // External, signed, per-tenant URL that changes host between the dev
  // filesystem proxy and R2 in prod — next/image's domain allowlist doesn't
  // fit that, so a plain <img> is the right call here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={school?.name ? `${school.name} logo` : "School logo"} className={className} />;
}
