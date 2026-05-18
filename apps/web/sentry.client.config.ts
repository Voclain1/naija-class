import * as Sentry from "@sentry/nextjs";

import { redactString, redactValue } from "@/lib/observability/redact";

// Browser-side Sentry init. Loaded by Next's client runtime — see
// instrumentation.ts. Blank DSN = no init = no SDK in the bundle's hot
// path (Sentry's tree-shaking takes care of the rest).

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (!dsn) {
  console.info("[sentry/web/client] disabled: NEXT_PUBLIC_SENTRY_DSN not set");
}

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
      process.env.NODE_ENV ??
      "development",
    // No tracing / no replay in Slice 8a.
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
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
