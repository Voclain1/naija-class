// Kill switch for the carry-over wizard.
//
// TEMPORARY. Added 2026-08-25 in response to a live data-integrity incident at
// a pilot school: one click moved an entire school's 12 students into a single
// class arm, and the per-term uniqueness rule then made every other arm's
// carry-over a silent no-op. See
// docs/runbooks/carry-over-incident-2026-08-25.md.
//
// The root cause is fixed in the same change that adds this file (the
// school-wide "admitted" candidate group no longer arrives pre-ticked, and a
// scale warning fires when it dwarfs the arm's real roster). The switch is
// belt AND braces: the fix is what makes the feature correct, this is what
// guarantees nobody exercises it again before the corrected placements have
// been restored at the affected school and the fix has been verified in
// production.
//
// WHAT THIS DOES AND DOES NOT BLOCK — stated plainly so nobody mistakes its
// reach:
//   - Blocks: the "Carry over N students" CTA on /enrollments, and the
//     /enrollments/bulk wizard itself if reached directly by URL. That is the
//     entire real-world path into this feature.
//   - Does NOT block: POST /enrollments/bulk at the API. That is deliberate —
//     the same endpoint is how corrected placements get written, and killing
//     it server-side would block the remediation as well as the incident.
//     Reaching it now requires deliberately crafting a request, which is not
//     the failure mode that occurred.
//
// TO RE-ENABLE: flip this to true and delete the notice copy below. Do that
// only once (a) the affected school's placements are corrected, and (b) the
// default-selection fix has been confirmed working in production.
export const CARRY_OVER_ENABLED = false;

// 2026-11-12: the wording no longer says "temporarily unavailable". The fault
// was fixed in August, and the per-class wizard is not coming back: the
// promotion engine (/enrollments/promote, docs/modules/promotion-engine.md)
// does the same job for every class at once, for a new term or a new session.
// Saying "temporarily" and "a fault" on every empty class told schools the
// product was broken when it is not.
export const CARRY_OVER_DISABLED_TITLE = "Carry over has moved";

export const CARRY_OVER_DISABLED_BODY =
  "Bringing students into a new term or a new session is now done for the whole school at once, under Bring students forward. Adding a student to a class one at a time still works as before.";
