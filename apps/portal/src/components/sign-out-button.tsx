"use client";

import { useState } from "react";

// The guardian portal's Sign out control (F-06).
//
// Before this existed there was NO way to end a portal session from the UI at
// all — no button, and no API endpoint behind one. On a shared device (a
// school office computer, a phone passed between parents, a cybercafé, which
// is a real access pattern for this product) the only way out was to clear
// browser cookies, and the session otherwise stayed valid for 30 days.
//
// Three deliberate behaviours:
//
//  1. It calls the API and WAITS. The cookie is only cleared by the proxy on
//     a 2xx, so a failed request leaves the guardian signed in and says so.
//     Clearing the cookie optimistically would be worse than doing nothing:
//     the browser would forget a token that is still live server-side,
//     leaving a session nobody can reach to revoke.
//
//  2. On success it navigates with window.location.replace, NOT the Next
//     router. This is the Back-button half of the shared-device problem.
//     router.push/replace leaves the authenticated React tree alive in
//     memory and the previous entry in the history stack; a full-document
//     replace tears the tree down and takes the authenticated URL OUT of the
//     stack, so Back cannot return to it. Combined with the no-store headers
//     that middleware.ts sets on protected routes, the previous page cannot
//     be re-served from cache either.
//
//  3. It is disabled while in flight, so an impatient double-tap cannot fire
//     two logout requests.
export function SignOutButton() {
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");

  async function onSignOut() {
    setState("submitting");
    try {
      const res = await fetch("/api/portal/logout", { method: "POST" });
      if (!res.ok) {
        setState("error");
        return;
      }
      // Full-document navigation — see (2) above.
      window.location.replace("/login");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onSignOut}
        disabled={state === "submitting"}
        className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "submitting" ? "Signing out…" : "Sign out"}
      </button>
      {state === "error" && (
        <p role="alert" className="text-right text-xs text-destructive">
          Could not sign out. You are still signed in — please try again.
        </p>
      )}
    </div>
  );
}
