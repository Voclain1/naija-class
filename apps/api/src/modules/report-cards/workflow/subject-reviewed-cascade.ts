import { withTenant } from "@school-kit/db";

// SUBJECT_REVIEWED eager cascade (Phase 2 / Slice 6). A plain function (no DI
// cycle) called from AssessmentService.signOff / signOffColumn AFTER the
// sign-off write, in the SAME tx. When the arm becomes fully signed off it
// advances the arm's DRAFT cards to SUBJECT_REVIEWED.
//
// Denominator (Q1): measured against EXISTING Assessment rows for (term, arm) —
// "every assessment that exists is signed off, and at least one exists". We do
// NOT enforce curriculum coverage here (an unscored subject simply has no row;
// form-review re-runs this same predicate, so completeness is still gated where
// it matters).
//
// NO auto-revert (Q2): an un-sign-off does NOT pull SUBJECT_REVIEWED back to
// DRAFT. The stored status can briefly be stale; form-review re-verifies with
// isArmFullySignedOff and 409s if a subject was un-signed. Eager-set is a
// display convenience, the transition is the real gate.

type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

// True when the arm has ≥1 Assessment and none are unsigned. Shared by the
// cascade and by form-review's precondition re-check (single source of truth).
export async function isArmFullySignedOff(
  db: TenantDb,
  termId: string,
  classArmId: string,
): Promise<boolean> {
  const total = await db.assessment.count({ where: { termId, classArmId } });
  if (total === 0) return false;
  const unsigned = await db.assessment.count({
    where: { termId, classArmId, subjectSignedOffAt: null },
  });
  return unsigned === 0;
}

// If the arm is now fully signed off, advance its DRAFT cards to
// SUBJECT_REVIEWED. Only DRAFT cards move — FORM_REVIEWED+ are left untouched
// (no down-transition). No audit row: this is a side-effect of sign-off, which
// already writes its own audit.
export async function cascadeSubjectReviewedIfComplete(
  db: TenantDb,
  termId: string,
  classArmId: string,
): Promise<void> {
  if (!(await isArmFullySignedOff(db, termId, classArmId))) return;
  await db.reportCard.updateMany({
    where: { termId, classArmId, status: "DRAFT" },
    data: { status: "SUBJECT_REVIEWED" },
  });
}
