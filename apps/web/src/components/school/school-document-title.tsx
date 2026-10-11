"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/lib/auth/use-auth";

// The browser tab names the school once someone is signed in to it
// (docs/modules/school-identity.md, slice 1). The root layout's static
// metadata title stays "SchoolKit" for signed-out pages. Re-applied on every
// route change, because client navigation can put the static title back.
export function SchoolDocumentTitle() {
  const { school } = useAuth();
  const pathname = usePathname();
  useEffect(() => {
    if (school?.name) document.title = `${school.name} · SchoolKit`;
  }, [school?.name, pathname]);
  return null;
}
