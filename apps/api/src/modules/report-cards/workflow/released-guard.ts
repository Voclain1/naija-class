import { withTenant } from "@school-kit/db";
import { ConflictError } from "@school-kit/types";

// Released-card immutability gate (Phase 2 / Slice 6). Once a ReportCard is
// RELEASED it is the record — its underlying scores/comments are frozen and may
// only change via an audited reopen. This is a plain FUNCTION (not a Nest
// provider) so AssessmentService can import it without an AssessmentModule ↔
// ReportCardsModule DI cycle.
//
// Scope (Q3): RELEASED-only. Edits in SUBJECT_REVIEWED / FORM_REVIEWED /
// PRINCIPAL_APPROVED are allowed; the workflow transitions re-check their
// preconditions to handle the resulting races. Build has its own stricter guard
// (non-DRAFT → reopen first), but score/sign-off writes block only on RELEASED.

type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

// Throws 409 if ANY of the given students has a RELEASED report card for the
// term. Called before every score/sign-off write. A no-op for an empty list.
export async function assertNoReleasedCards(
  db: TenantDb,
  termId: string,
  studentIds: readonly string[],
): Promise<void> {
  if (studentIds.length === 0) return;
  const released = await db.reportCard.findFirst({
    where: { termId, studentId: { in: [...studentIds] }, status: "RELEASED" },
    select: { id: true },
  });
  if (released) {
    throw new ConflictError(
      "REPORT_CARD_RELEASED",
      "This report card has been released and is locked. Reopen the arm before changing scores or sign-off.",
    );
  }
}
