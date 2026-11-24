// Sentry initialisation for the NestJS API.
//
// Init runs at the very top of main.ts, BEFORE NestFactory.create. Sentry's
// OpenTelemetry-based instrumentation patches import hooks to wrap database
// drivers, HTTP clients, and Nest internals; the patching only catches code
// loaded after init runs.
//
// No-DSN-means-no-op: dev work cannot depend on a third-party service.
// If SENTRY_DSN_API is blank or absent, init returns without calling
// Sentry.init. Sentry.captureException becomes a documented safe no-op,
// so call sites do not need to know whether the SDK is live.

import * as Sentry from "@sentry/nestjs";

import { redactString, redactValue } from "@school-kit/types";

let initialised = false;

function isMetaWebhook(url: string | undefined): boolean {
  return typeof url === "string" && /\/webhooks\/meta(?:\/|[?#]|$)/.test(url);
}

/** Routes whose request bodies never reach an error report. */
export function dropsRequestBody(url: string | undefined): boolean {
  return (typeof url === "string" && /\/webhooks\/termii(?:[/?#]|$)/.test(url)) || (typeof url === "string" && /\/messaging\/whatsapp\/signup(?:[/?#]|$)/.test(url)) || isMetaWebhook(url) || (typeof url === "string" && /\/assistant\//.test(url));
}

export function initSentry(): void {
  if (initialised) return;
  const dsn = process.env.SENTRY_DSN_API;
  if (!dsn) {
    // Single boot-time line so future-me can tell "disabled" from "broken".
    // Logger isn't bootstrapped here yet; raw console is fine — main.ts has
    // not created NestFactory at this point in the lifecycle.
    console.info("[sentry] disabled: SENTRY_DSN_API not set");
    return;
  }

  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    // Set by Docker ARG SENTRY_RELEASE in production (= git SHA from CI).
    // Undefined in dev — Sentry still captures errors, just without a
    // release tag for source map lookup.
    ...(process.env.SENTRY_RELEASE ? { release: process.env.SENTRY_RELEASE } : {}),
    // No performance tracing in Slice 8a. Set to a non-zero number later if
    // we want APM; that pulls in extra infra and is out of scope here.
    tracesSampleRate: 0,
    // Default integrations include Http, Console, OnUncaughtException,
    // OnUnhandledRejection — exactly what we want.
    beforeBreadcrumb(breadcrumb) {
      const url: unknown = breadcrumb.data?.url;
      // Meta's debug-token protocol carries the business token in the query.
      if (typeof url === "string" && /graph\.facebook\.com\/[^/]+\/(?:debug_token|oauth\/(?:access_token|revoke))(?:[?#]|$)/i.test(url)) return null;
      return breadcrumb;
    },
    beforeSend(event) {
      // Strip auth headers entirely — never useful in a stack trace, always
      // sensitive. Replace cookies the same way.
      const req = event.request;
      if (req && isMetaWebhook(req.url)) {
        // The challenge embeds a verification secret in its query string.
        req.url = req.url?.split("?")[0];
        req.query_string = undefined;
        req.headers = undefined;
      }
      if (req?.headers) {
        const headers = { ...req.headers };
        delete headers.authorization;
        delete headers.Authorization;
        delete headers.cookie;
        delete headers.Cookie;
        req.headers = headers;
      }
      if (req?.data !== undefined) {
        // Assistant requests carry conversation text, transcripts, typed names
        // and spoken replies: drop the whole body for EVERY assistant route
        // (chat turns, voice turns and speech, named lookup, billing), rather
        // than relying on pattern redaction (docs/modules/assistant-ai-governance.md).
        req.data = dropsRequestBody(req.url) ? undefined : redactValue(req.data) as typeof req.data;
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
      // Exception values can contain interpolated user data ("user
      // mayowa@example.com not found"). Walk every frame's message.
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) ex.value = redactString(ex.value);
        }
      }
      if (event.message) {
        event.message = typeof event.message === "string"
          ? redactString(event.message)
          : event.message;
      }
      return event;
    },
  });

  initialised = true;
  console.info(
    `[sentry] initialised (env=${process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development"})`,
  );
}

// Re-exported for the HttpExceptionFilter so the filter has a single import
// site and we can mock this module in tests.
export { Sentry };
