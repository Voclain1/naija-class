"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Top-level error boundary. Catches render errors that escape every other
// boundary (root layout failures, errors in (admin)/error.tsx itself).
// The official Sentry + Next.js 15 pattern — see Sentry docs "App Router".
//
// Renders a deliberately minimal error UI so even if the app's CSS or
// fonts are the thing that broke, the user still sees readable text and a
// retry button.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
        <p style={{ color: "#666", margin: 0 }}>
          The page failed to load. Try refreshing — if it keeps happening,
          contact support.
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: 8,
            padding: "8px 16px",
            border: "1px solid #ccc",
            borderRadius: 4,
            background: "white",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
