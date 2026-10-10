// Server-side PostHog for the NestJS API.
//
// Until 2026-10-10 product analytics were browser-only (apps/web), so anything
// the API saw and the browser did not — a request from the mobile app or the
// parent portal, or a rejection the page swallowed — was invisible to them.
//
// Same no-key-means-no-op contract as Sentry (./sentry.ts): if POSTHOG_API_KEY
// is blank or absent, no client is built and capture() does nothing, so dev,
// test and CI never call out and call sites need not know.
//
// PII rule (CLAUDE.md): an event carries opaque ids and shapes only — never an
// email, phone, name, request body or error message. The distinct id is the
// user's UUID (or "anonymous" before sign-in), which PostHog already holds for
// the same user from the web app's identify().

import { PostHog } from "posthog-node";

let client: PostHog | null | undefined;

function getClient(): PostHog | null {
  if (client !== undefined) return client;
  const key = process.env.POSTHOG_API_KEY;
  if (!key) {
    client = null;
    return client;
  }
  client = new PostHog(key, {
    host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    // Small batches: these are low-volume operational events, and a Fly
    // machine can be stopped between requests.
    flushAt: 10,
    flushInterval: 5_000,
  });
  return client;
}

export interface ServerEvent {
  event: "validation_rejected";
  distinctId: string;
  properties: Record<string, string | number | boolean | string[] | null>;
}

export function captureServerEvent({ event, distinctId, properties }: ServerEvent): void {
  const ph = getClient();
  if (!ph) return;
  ph.capture({ distinctId, event, properties });
}

/** Flush queued events; called on shutdown so a stopping machine does not drop them. */
export async function shutdownPostHog(): Promise<void> {
  if (client) await client.shutdown();
}

/** Test-only: forget the cached client so a spec can change the env. */
export function resetPostHogForTests(): void {
  client = undefined;
}
