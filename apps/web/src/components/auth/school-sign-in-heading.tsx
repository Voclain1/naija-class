"use client";

import { useEffect, useState } from "react";

import type { SchoolPublicDto } from "@school-kit/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/**
 * "Signing in to <school>" above the sign-in form, when the person came from
 * the school's own address (?school=<code>, docs/modules/school-addresses.md).
 * The school's name and logo only; it changes nothing about how sign-in works.
 * Nothing shows until the school is found, and nothing if it is not.
 */
export function SchoolSignInHeading({ code }: { code: string }) {
  const [school, setSchool] = useState<SchoolPublicDto | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/school-addresses/${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? (r.json() as Promise<SchoolPublicDto>) : null))
      .then((s) => {
        if (!cancelled) setSchool(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [code]);
  if (!school) return null;
  return (
    <div className="mt-3 flex items-center gap-3 rounded-md bg-muted/50 px-3 py-2" data-testid="school-sign-in-heading">
      {school.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- a signed URL, valid for an hour
        <img src={school.logoUrl} alt="" className="h-10 w-10 rounded-md object-contain" />
      )}
      <p className="text-sm">
        Signing in to <span className="font-medium text-foreground">{school.name}</span>
      </p>
    </div>
  );
}
