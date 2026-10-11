"use client";

import { useEffect, useState } from "react";

import { schoolInitials, type SchoolContactResponse } from "@school-kit/types";

// The school's own name and logo at the top of every signed-in portal page
// (docs/modules/school-identity.md, slice 1). Sign-in pages keep SchoolKit's
// BrandHeading: before a parent signs in, the portal does not know the school.
//
// One read per hour at most: GET /portal/school signs the logo URL for an hour,
// and every signed-in page mounts this banner.
const REUSE_MS = 45 * 60 * 1000;
let cached: { at: number; promise: Promise<SchoolContactResponse | null> } | null = null;

function loadSchool(): Promise<SchoolContactResponse | null> {
  if (cached && Date.now() - cached.at < REUSE_MS) return cached.promise;
  const promise = fetch("/api/portal/school")
    .then(async (res) => (res.ok ? ((await res.json()) as SchoolContactResponse) : null))
    .catch(() => null)
    .then((school) => {
      // Never keep a miss: a signed-out read must not stick after sign-in.
      if (!school) cached = null;
      return school;
    });
  cached = { at: Date.now(), promise };
  return promise;
}

export function SchoolBanner() {
  const [school, setSchool] = useState<SchoolContactResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSchool().then((s) => {
      if (cancelled || !s) return;
      setSchool(s);
      document.title = `${s.name} · Parent Portal`;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Holds its height while loading so the page below does not jump.
  if (!school) return <div className="h-10" aria-hidden="true" />;

  return (
    <div className="flex h-10 items-center gap-3">
      {school.logoUrl ? (
        // Signed, per-school URL on R2: next/image's allowlist does not fit it.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={school.logoUrl} alt={`${school.name} logo`} className="h-10 w-10 shrink-0 rounded object-contain" />
      ) : (
        <span
          aria-hidden="true"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
        >
          {schoolInitials(school.name)}
        </span>
      )}
      <span className="truncate text-base font-semibold tracking-tight text-foreground">{school.name}</span>
    </div>
  );
}
