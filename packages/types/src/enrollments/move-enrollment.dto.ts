import { z } from "zod";

import type { EnrollmentDto } from "./enrollment.dto.js";

// POST /enrollments/:id/move — move a placed student to another class for
// the SAME term (D39, docs/modules/staff-mobile-companion.md). Not a
// promotion: promotions create next term's enrolments through their own flow
// and never come here.
//
// What moves with the child: the enrolment, and their per-subject assessment
// rows (whose class_arm_id is denormalised for position scans). Their entered
// marks (assessment_scores) are keyed by student, not class, so they follow
// on their own. What is discarded: a DRAFT report card, which is a snapshot of
// the OLD class and is rebuilt for the new one. A report card past DRAFT
// blocks the move until the class is reopened.
//
// `currentPassword` is required whenever the child already has marks or a
// report card this term — the maintainer's safeguard (2026-09-21): changing a
// child's records mid-term needs the admin to prove it is them, not just a tap
// on an unlocked phone. A move with nothing to change needs no password.
export const moveEnrollmentSchema = z
  .object({
    classArmId: z.string().uuid(),
    currentPassword: z.string().min(1).max(200).optional(),
  })
  .strict();
export type MoveEnrollmentInput = z.infer<typeof moveEnrollmentSchema>;

/** Returned in the 409 MOVE_NEEDS_PASSWORD error's `details`. */
export interface MoveEnrollmentRecordsDto {
  /** Marks already entered for this child this term. */
  markCount: number;
  /** A draft report card exists and will be discarded. */
  hasReportCard: boolean;
}

export interface MoveEnrollmentResultDto {
  enrollment: EnrollmentDto;
  /** Per-subject rows re-pointed to the new class. */
  assessmentsMoved: number;
  /** The draft report card was discarded, to be rebuilt in the new class. */
  reportCardDiscarded: boolean;
  /**
   * The move changed class LEVEL and the child has a fee invoice this term.
   * Fees are never touched here (money goes through FinanceService); the
   * bursar should review the invoice.
   */
  invoiceNeedsReview: boolean;
}
