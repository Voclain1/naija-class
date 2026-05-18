"use client";

import posthog from "posthog-js";
import { PostHogProvider as PostHogReactProvider } from "posthog-js/react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

// PostHog provider with the explicit no-key = no-op contract. If
// NEXT_PUBLIC_POSTHOG_KEY is blank, children render unwrapped — no SDK
// load, no script tag, no network calls. Dev work cannot depend on a live
// third-party service.
//
// Autocapture is on for clicks and submits only — input/change events are
// excluded so the SDK never reads form values. Session recording is OFF
// (school platform with student PII would need NDPR consent + DPO sign-off
// before recording could be enabled).
export function PostHogProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
    if (!key) {
      console.info("[posthog] disabled: NEXT_PUBLIC_POSTHOG_KEY not set");
      return;
    }
    posthog.init(key, {
      api_host: host,
      capture_pageview: true,
      capture_pageleave: true,
      // Autocapture: limit to interactions that don't carry PII. clicks +
      // submits give us funnel signal; change/input would expose form text.
      autocapture: {
        dom_event_allowlist: ["click", "submit"],
        element_allowlist: ["a", "button"],
      },
      persistence: "localStorage+cookie",
      disable_session_recording: true,
      // Quiet in dev — uncomment debug() locally if needed.
      loaded: () => setReady(true),
    });
    console.info("[posthog] initialised");
  }, []);

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return <>{children}</>;
  // Even while the SDK loads, render children — events fired before `ready`
  // are queued by posthog-js internally and flush once init completes.
  void ready;
  return <PostHogReactProvider client={posthog}>{children}</PostHogReactProvider>;
}
