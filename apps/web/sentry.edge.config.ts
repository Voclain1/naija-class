import * as Sentry from "@sentry/nextjs";

// Edge runtime is unused in Phase 0 — no middleware, no edge route handlers.
// The file must still exist because Next's Sentry integration warns when
// any of the three configs is missing. Keeps the smallest possible init so
// if we accidentally start emitting from an edge surface, errors land
// alongside the others rather than vanishing.

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0,
  });
}
