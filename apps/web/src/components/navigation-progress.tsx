"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { BrandMark } from "@/components/brand-loading-screen";

// Closes a real gap found 2026-07-31 while verifying the site-wide loading
// state (#7): Next.js App Router's `loading.tsx` is a Suspense fallback — it
// only shows while a route segment's SERVER-side async work is pending. This
// app's pages are all "use client" components that fetch their own data via
// useEffect, so there's nothing for Suspense to wait on; a slow client-side
// navigation (exactly the #4 stall scenario) shows ZERO visual feedback by
// default — confirmed by deliberately blocking a sidebar-link navigation for
// a real 3s via request interception and screenshotting: the old page just
// sits there, frozen, with no indicator at all. That's the actual "clicked
// and nothing happened" first-impression risk this component exists to close.
//
// How it works (no changes to any existing Link/button anywhere):
//   1. A capture-phase click listener on `document` catches EVERY click on
//      an internal <a> (sidebar, in-page "View" buttons, breadcrumbs, the
//      command palette — anything rendered as a real anchor) and starts a
//      pending navigation, before the browser even begins the network fetch.
//   2. The overlay itself only shows after SHOW_DELAY_MS — most navigations
//      are already-prefetched/cached and resolve near-instantly; showing the
//      overlay for those would just be a one-frame flicker, not useful
//      feedback. Confirmed by real testing: a genuinely slow transition
//      (2s, matching the actual #4 stall spike measured earlier) shows the
//      overlay correctly; a normal fast transition never flickers it in.
//   3. `usePathname()`/`useSearchParams()` reflect the CURRENT route only
//      once Next.js has actually finished transitioning to it — so clearing
//      state in a `useEffect` keyed on those values fires exactly when the
//      destination has rendered, not before. Verified directly: blocking a
//      navigation's request for 2s via network interception, screenshotting
//      mid-block (overlay visible), then confirming it clears the instant
//      the real page renders.
//   4. A safety-net timeout auto-clears everything after 15s regardless, so
//      a missed edge case (e.g. a same-path hash-only navigation this
//      listener doesn't treat as "different", or a navigation Next itself
//      aborts) can never leave the overlay stuck — a stuck full-screen
//      overlay would be a far worse regression than the missing-feedback
//      problem this closes.
const SHOW_DELAY_MS = 150;

export function NavigationProgress() {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function clearPending() {
      setVisible(false);
      if (showDelayRef.current) {
        clearTimeout(showDelayRef.current);
        showDelayRef.current = null;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }

    function beginPending() {
      if (showDelayRef.current) clearTimeout(showDelayRef.current);
      showDelayRef.current = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(clearPending, 15000);
    }

    function onClick(event: MouseEvent) {
      // Modifier/middle-click opens in a new tab (or downloads) — the
      // current page never navigates, so no indicator should show.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as Element | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // external link
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return; // already there — not a real navigation
      }

      beginPending();
    }

    function onPopState() {
      beginPending();
    }

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // The destination route has now actually rendered — clear immediately.
  useEffect(() => {
    setVisible(false);
    if (showDelayRef.current) {
      clearTimeout(showDelayRef.current);
      showDelayRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [pathname, searchParams]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-sm"
    >
      <BrandMark size={48} />
    </div>
  );
}
