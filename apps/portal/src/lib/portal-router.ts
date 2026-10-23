"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { portalPath } from "./portal-path";

// useRouter for the parents' pages: push and replace gain /parents at a
// school's own address (lib/portal-path.ts).
export function usePortalRouter(): ReturnType<typeof useRouter> {
  const router = useRouter();
  return useMemo(
    () => ({
      ...router,
      push: (href, options) => router.push(portalPath(href), options),
      replace: (href, options) => router.replace(portalPath(href), options),
      prefetch: (href, options) => router.prefetch(portalPath(href), options),
    }),
    [router],
  );
}
