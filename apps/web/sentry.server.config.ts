import * as Sentry from "@sentry/nextjs";

import { redactString, redactValue } from "@/lib/observability/redact";

// Server-side (Node runtime) Sentry init for Next.js SSR / route handlers.
// The API has its own Sentry project; this one catches errors that
// originate from inside the web app's Node side (server components,
// route handlers, middleware).
//
// Reads NEXT_PUBLIC_SENTRY_DSN so the same DSN serves both client and
// server-side errors of the web project. They'll be distinguishable in
// Sentry by event tag `runtime: server` vs `browser`.

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (!dsn) {
  console.info("[sentry/web/server] disabled: NEXT_PUBLIC_SENTRY_DSN not set");
}

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0,
    beforeSend(event) {
      const req = event.request;
      if (req?.headers) {
        const headers = { ...req.headers };
        delete headers.authorization;
        delete headers.Authorization;
        delete headers.cookie;
        delete headers.Cookie;
        req.headers = headers;
      }
      if (req?.data !== undefined) {
        req.data = redactValue(req.data) as typeof req.data;
      }
      if (req?.query_string !== undefined && typeof req.query_string === "string") {
        req.query_string = redactString(req.query_string);
      }
      if (event.extra) {
        event.extra = redactValue(event.extra) as typeof event.extra;
      }
      if (event.contexts) {
        event.contexts = redactValue(event.contexts) as typeof event.contexts;
      }
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) ex.value = redactString(ex.value);
        }
      }
      if (event.message && typeof event.message === "string") {
        event.message = redactString(event.message);
      }
      return event;
    },
  });
}
