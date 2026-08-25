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

export const CARRY_OVER_DISABLED_TITLE = "Carry over is temporarily unavailable";

export const CARRY_OVER_DISABLED_BODY =
  "We found a fault that could move students into the wrong class, so this feature is switched off while it is corrected. Nothing you have already done is lost, and enrolling students individually still works normally.";
