"use client";

import posthog from "posthog-js";

// Typed dispatcher for the six Phase 0 product events. One file to grep when
// asking "what events does this app emit?" — and the enumerated union below
// is the lock on event naming. No free-form strings.
//
// PII rule (CLAUDE.md): no event payload may contain email, phone, password,
// raw token, or first/last name. Only opaque IDs, role keys, and school
// status. Reviewer should grep for `track(` and confirm at PR time.

export type EventName =
  | "signup_completed"
  | "login_completed"
  | "onboarding_step_completed"
  | "onboarding_step_rejected"
  | "onboarding_completed"
  | "invitation_sent"
  | "invitation_accepted";

interface BasePayload {
  schoolId: string;
}

interface SignupCompleted extends BasePayload {
  schoolStatus: string;
  role: string;
}

interface LoginCompleted extends BasePayload {
  role: string;
}

type OnboardingStep = 1 | 2 | 3 | 4 | 5;

interface OnboardingStepCompleted extends BasePayload {
  step: OnboardingStep;
}

// A step the owner tried to move past and could not (2026-10-10). Paired with
// onboarding_step_completed for the same step, a funnel shows who was turned
// back and whether they then got through — the signal the 2026-09-11 step-5
// incident lacked (docs/deferred.md, "Repeated validation failures"). Field
// paths with indexes as `*` and validator codes only: never what was typed,
// never the message.
interface OnboardingStepRejected extends BasePayload {
  step: OnboardingStep;
  /** "client": the form's own copy of the server schema stopped it; "server": the API did. */
  source: "client" | "server";
  issuePaths: string[];
  errorCode: string;
}

type OnboardingCompleted = BasePayload;

interface InvitationSent extends BasePayload {
  roleKey: string;
}

interface InvitationAccepted extends BasePayload {
  roleKey: string;
}

type EventPayload = {
  signup_completed: SignupCompleted;
  login_completed: LoginCompleted;
  onboarding_step_completed: OnboardingStepCompleted;
  onboarding_step_rejected: OnboardingStepRejected;
  onboarding_completed: OnboardingCompleted;
  invitation_sent: InvitationSent;
  invitation_accepted: InvitationAccepted;
};

// `$insert_id` is a PostHog convention: when present, the ingestion side
// deduplicates events with the same key. Used for onboarding_completed so a
// refresh of the step-5 page doesn't double-count completion.
type OptionalSendHopts = { $insert_id?: string };

export function track<E extends EventName>(
  event: E,
  payload: EventPayload[E],
  options: OptionalSendHopts = {},
): void {
  if (typeof window === "undefined") return;
  // posthog-js is safe to call when uninitialised (no-op + console warning
  // in dev). We still gate on `__loaded` to keep the dev console quiet
  // during the no-key path.
  const ph = posthog as unknown as { __loaded?: boolean };
  if (!ph.__loaded) return;
  posthog.capture(event, { ...payload, ...options });
}

// Identity helpers — thin wrappers so consumers don't import posthog-js
// directly. Provider initialisation is the only other place that does.
export function identify(
  userId: string,
  properties: { schoolId: string; schoolStatus: string; role: string | undefined },
): void {
  if (typeof window === "undefined") return;
  const ph = posthog as unknown as { __loaded?: boolean };
  if (!ph.__loaded) return;
  posthog.identify(userId, properties);
}

export function resetIdentity(): void {
  if (typeof window === "undefined") return;
  const ph = posthog as unknown as { __loaded?: boolean };
  if (!ph.__loaded) return;
  posthog.reset();
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A field path with array indexes and ids replaced by `*`, so paths group. */
export function normaliseIssuePath(path: unknown): string {
  const segments = Array.isArray(path) ? path.map(String) : typeof path === "string" ? path.split(".") : [];
  if (segments.length === 0) return "(root)";
  return segments.map((s) => (/^\d+$/.test(s) || UUID_SEGMENT.test(s) ? "*" : s)).join(".");
}

/** The distinct field paths of an API error's `details.issues`, for an analytics event. */
export function issuePathsOf(details: unknown): string[] {
  const issues = (details as { issues?: unknown } | null | undefined)?.issues;
  if (!Array.isArray(issues)) return [];
  return [...new Set(issues.map((i) => normaliseIssuePath((i as { path?: unknown } | null)?.path)))];
}

/**
 * Record a server-side refusal of an onboarding step. Only 400s count: a
 * network failure or a 5xx is not the owner being turned back by the form.
 */
export function trackOnboardingServerRejection(
  schoolId: string | undefined,
  step: OnboardingStep,
  error: { status: number; code: string; details?: unknown },
): void {
  if (!schoolId || error.status !== 400) return;
  track("onboarding_step_rejected", {
    schoolId,
    step,
    source: "server",
    issuePaths: issuePathsOf(error.details),
    errorCode: error.code,
  });
}
