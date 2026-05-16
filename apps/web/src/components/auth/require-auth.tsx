"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth/use-auth";

import { BrandLoadingScreen } from "../brand-loading-screen";

// Client-side gate wrapping any (admin) page. The token lives in
// localStorage in Phase 0, so the redirect cannot happen in middleware —
// it happens here, after the auth provider has hydrated. Three states:
//
//   loading → render the branded loading screen (NOT a blank screen, so
//             "we're loading" reads clearly to the user rather than
//             "the page is broken").
//   guest   → trigger a replace() to /login, render the loading screen
//             during the navigation tick.
//   authed  → render children.
//
// When the cookie-based auth migration in deferred.md lands, this can be
// replaced with a server-component redirect for snappier perceived load.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "guest") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status !== "authed") {
    return <BrandLoadingScreen />;
  }

  return <>{children}</>;
}
