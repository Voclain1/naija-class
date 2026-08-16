// Phase 6 / Slice 3 follow-up — which enrolment statuses may hold, and which
// may OBTAIN, student portal credentials.
//
// These are two different questions with two different answers, which is the
// whole reason this file exists. Until 2026-08-16 both were the same literal
// `"ACTIVE"`, duplicated in StudentAuthGuard and StudentPortalService; the
// duplication hid the fact that nobody had ever decided them separately.
//
//   KEEPING access  — a student who was properly activated while enrolled
//                     keeps reading their OWN history after they leave. A
//                     school-leaver wanting their results is the most likely
//                     moment they ever want them, and the school marking a
//                     term complete should not be what takes them away.
//
//   OBTAINING access — a FIRST credential is guardian-mediated supervision of
//                     a live school relationship. Once that relationship has
//                     ended there is no supervision left to mediate, so a
//                     first-time activation has a meaningfully weaker
//                     justification than continued access does.
//
// Hence: WITHDRAWN and GRADUATED may sign in if they already have a password,
// and may NOT accept a fresh invitation to create one.
//
// SUSPENDED and INACTIVE are in neither set. Suspension is the school's active
// judgement about a currently-enrolled pupil, and INACTIVE is an
// administrative hold — both are "we are deliberately holding this account
// down right now", unlike WITHDRAWN/GRADUATED which are "this person has
// finished". That distinction is the axis these two sets turn on, not
// severity.
//
// Note the asymmetry runs one way only: every status that may ACCEPT is also
// a status that may SIGN IN. A set where that failed would let a student
// create a credential they cannot then use.

import type { StudentStatus } from "@school-kit/db";

/**
 * Statuses permitted to hold a live portal session — checked on every request
 * by StudentAuthGuard, and at login by StudentPortalService.
 */
export const PORTAL_SESSION_STATUSES: readonly StudentStatus[] = [
  "ACTIVE",
  "WITHDRAWN",
  "GRADUATED",
];

/**
 * Statuses permitted to ACCEPT an invitation and set a first password.
 * Deliberately narrower than the set above.
 */
export const PORTAL_ACTIVATION_STATUSES: readonly StudentStatus[] = ["ACTIVE"];

export function mayHoldSession(status: string): boolean {
  return (PORTAL_SESSION_STATUSES as readonly string[]).includes(status);
}

export function mayActivate(status: string): boolean {
  return (PORTAL_ACTIVATION_STATUSES as readonly string[]).includes(status);
}
