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

interface OnboardingStepCompleted extends BasePayload {
  step: 1 | 2 | 3 | 4;
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
