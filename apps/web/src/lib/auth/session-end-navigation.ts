// The one fact every unsaved-changes guard needs and none of them had: is the
// navigation about to happen a CHOICE the user is making, or an eviction?
//
// ---------------------------------------------------------------------------
// THE BUG THIS EXISTS TO CLOSE
//
// A `beforeunload` guard asks "you have unsaved work — leave or stay?". That is
// an honest question for a voluntary exit: staying keeps the work, and the
// Save button still works. It is a LIE during a forced sign-out.
//
// When the API returns 401, `apiFetch` clears the stored token and dispatches
// AUTH_UNAUTHORIZED_EVENT. The auth provider's listener runs synchronously and
// does three things: clears the token again, queues `setState(guestState())`,
// then calls `window.location.replace(...)`. That last call fires
// `beforeunload` — so the dialog appears with the credential ALREADY GONE.
//
// Then whichever answer the user gives, the work is lost:
//
//   Leave → the document is replaced. Correct, and the login screen explains
//           why (?reason=...). The unsaved work is gone, but nothing pretended
//           otherwise.
//
//   Stay  → the navigation is cancelled, and that is all it cancels. The
//           queued guest state flushes, `RequireAuth` renders its loading
//           screen for any non-`authed` status, and the whole dirty form
//           subtree UNMOUNTS — typed values and all. `RequireAuth`'s guest
//           branch then does a CLIENT-side `router.replace`, which
//           `beforeunload` cannot intercept, carrying `reason: null` because
//           that code path genuinely cannot know why. The user is ejected
//           anyway, having lost the work AND the explanation.
//
// Reproduced 2026-08-28 against a local database on the gradebook and the
// class-subject matrix: identical scenario, `/login?reason=revoked&next=...`
// with the notice shown when the dialog proceeded, bare `/login` with no
// reason and no notice when it was dismissed.
//
// So the work is not destroyed by the navigation. It is destroyed by the state
// change that precedes it, which no dialog can undo.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE DOES, AND DELIBERATELY DOES NOT DO
//
// It does NOT preserve the work. Preserving it would mean keeping a populated,
// authenticated view mounted behind an invalid credential — reversing the
// guarantee the full-document replace exists to give (no stale protected data
// left in memory on a shared school computer). That is a per-surface question
// with its own design, tracked in docs/deferred.md.
//
// It removes the FALSE CHOICE. A forced sign-out marks itself here, every
// `beforeunload` guard stands down for it, and the eviction happens once,
// cleanly, with the reason intact. The user still loses the unsaved work —
// they simply are not offered a button that pretends to save it.
//
// The flag is deliberately module-level rather than React state: `beforeunload`
// fires synchronously inside `window.location.replace()`, long before any
// re-render could publish a new context value.
//
// Lifetime is one document. A forced sign-out sets the flag and immediately
// replaces the document, so the next page starts with a fresh module and a
// cleared flag. Nothing needs to reset it in production — `resetForTests` is
// only so unit tests can run in any order.

import type { SessionEndReason } from "./session-end.js";

let authForced = false;
let pendingReason: SessionEndReason | null = null;

/**
 * Mark the navigation that is about to start as an eviction, not a choice.
 *
 * MUST be called synchronously immediately before `window.location.replace`,
 * because `beforeunload` fires inside that call.
 *
 * The reason is parked here too. `RequireAuth`'s guest branch cannot know why
 * a session ended — it sees only "not authed" — so if it ever wins the race
 * against the forced navigation it would redirect with no explanation at all.
 * Reading the parked reason means the explanation survives whichever path
 * gets there first. It is never set by a cold load with no session, so a
 * first-time visitor is still told nothing, which is correct.
 */
export function beginAuthForcedNavigation(reason: SessionEndReason | null): void {
  authForced = true;
  parkSessionEndReason(reason);
}

/**
 * Park a reason WITHOUT claiming a forced navigation is in flight.
 *
 * Split out from `beginAuthForcedNavigation` for the cold-boot hydration path,
 * which is the one place that learns why a session ended and then does NOT
 * navigate itself. `GET /auth/me` during hydration is deliberately sent with
 * `notifyOnUnauthorized: false` — it must not fire the eviction event, because
 * on a hard navigation it is simply establishing whether a session exists.
 * When it comes back 401 the provider drops quietly to guest and leaves the
 * redirect to `RequireAuth`, which on its own cannot know why.
 *
 * Before this, that path lost the reason entirely: a teacher whose account had
 * been deactivated could follow any in-app link and land on a bare `/login`
 * with no explanation, even though the API had just said USER_INACTIVE. Found
 * by the deactivation test in e2e/tests/session-end-work-loss.spec.ts.
 *
 * It must NOT set the forced-navigation flag: no navigation is starting here,
 * and raising the flag would silence every unsaved-changes guard in the
 * document for the rest of its life.
 */
export function parkSessionEndReason(reason: SessionEndReason | null): void {
  pendingReason = reason;
}

/**
 * Should an unsaved-changes guard stand down?
 *
 * Every `beforeunload` handler in the app calls this first and returns without
 * calling `preventDefault()` when it is true. See the invariant spec beside
 * this file — a new guard that forgets fails CI rather than shipping a dialog
 * whose "Stay" cannot stay.
 */
export function isAuthForcedNavigation(): boolean {
  return authForced;
}

/** The reason a forced sign-out is in flight, for a redirect that lacks one. */
export function consumeSessionEndReason(): SessionEndReason | null {
  return pendingReason;
}

/** Test-only. Production never clears these — the document is replaced. */
export function resetForTests(): void {
  authForced = false;
  pendingReason = null;
}
