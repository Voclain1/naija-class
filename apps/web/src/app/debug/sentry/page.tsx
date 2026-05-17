"use client";

import { notFound } from "next/navigation";
import { useState } from "react";

// Dev-only verification surface for Sentry's client-side capture. Hidden:
// the page returns 404 in production builds (Next can't easily exclude a
// route folder at build time without an env-var flag, so the gate is a
// runtime notFound() — production users hitting /debug/sentry get the
// same response as any unknown URL).
//
// Not linked from any nav. Discoverable only by typing the URL.
export default function SentryDebugPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const [crash, setCrash] = useState(false);

  if (crash) {
    // Throw during render so React's error boundary catches it and
    // global-error.tsx forwards to Sentry.captureException. A throw inside
    // an event handler would NOT trigger the boundary — that path goes
    // through window.onerror, which Sentry's browser SDK auto-instruments
    // but global-error.tsx wouldn't render for.
    throw new Error("Slice 8a Sentry verification: intentional render error");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 24,
      }}
    >
      <h1>Sentry verification</h1>
      <p style={{ color: "#666" }}>
        Click the button to throw a render error. The error should appear in
        the <code>school-kit-web</code> Sentry project within ~30 seconds.
      </p>
      <button
        onClick={() => setCrash(true)}
        style={{
          padding: "8px 16px",
          border: "1px solid #ccc",
          borderRadius: 4,
          background: "white",
          cursor: "pointer",
        }}
      >
        Throw render error
      </button>
    </main>
  );
}
