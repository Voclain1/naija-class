import type { EnrollmentStatusDto } from "../enrollments/enrollment.dto.js";

// Promotion engine — response shapes (2026-09-17).
//
// See docs/modules/promotion-engine.md. This replaces the per-arm carry-over
// wizard (/enrollments/bulk), which has been kill-switched since the
// 2026-08-25 incident. The structural difference, and the whole reason this
// module exists rather than a re-enable: EVERY candidate row here is derived
// from a REAL enrollment in the source term. There is no "all ACTIVE students"
// group, so the defect that swept a school into one arm cannot be expressed.

/**
 * What the engine is proposing, derived from the two terms — never sent by the
 * client.
 *
 *  - `YEAR_PROMOTION` — target term is in a LATER academic year than the
 *    source. Students move UP a class level (Primary 1 → Primary 2), keeping
 *    their arm position (Primary 1B → Primary 2B).
 *  - `TERM_ROLL` — both terms are in the SAME academic year. Students stay
 *    exactly where they are; this is the old carry-over, school-wide and in
 *    one approval.
 */
export type PromotionMode = "YEAR_PROMOTION" | "TERM_ROLL";

/**
 * Per-student decision. The admin may change any row's action before
 * committing; the preview only proposes.
 *
 *  - `PROMOTE`  — enrol into the destination arm (the next level's matching
 *                 arm in YEAR_PROMOTION; the same arm in TERM_ROLL).
 *  - `REPEAT`   — enrol into the SOURCE arm again (YEAR_PROMOTION only).
 *  - `GRADUATE` — no target enrollment; the student leaves the school.
 *  - `EXCLUDE`  — do nothing at all for this student.
 */
export type PromotionAction = "PROMOTE" | "REPEAT" | "GRADUATE" | "EXCLUDE";

/**
 * Why the engine could not propose a straightforward PROMOTE. Advisory, not
 * a lock: a blocked row is still listed (the admin must SEE every student the
 * roll touches), and the admin can still commit it by naming a destination
 * arm themselves — which is the only way a PROMOTE ever gets one, blocked or
 * not.
 *
 *  - `NO_DESTINATION_LEVEL` — the source level is the top of the ladder
 *    (no active level with a higher orderIndex). Proposed as GRADUATE.
 *  - `NO_DESTINATION_ARM` — the next level exists but has no arm at this
 *    arm's position. The admin creates one, or picks another arm in that
 *    level. Surfaced once per source arm in `gaps`, not once per student.
 *  - `ALREADY_ENROLLED` — the student already holds an enrollment in the
 *    target term. Proposed as EXCLUDE; this is what makes re-running a
 *    partially-committed promotion safe. Committing PROMOTE anyway is not an
 *    error — the write is skipped and counted.
 */
export type PromotionBlockReason =
  | "NO_DESTINATION_LEVEL"
  | "NO_DESTINATION_ARM"
  | "ALREADY_ENROLLED";

export interface PromotionTermRefDto {
  id: string;
  name: string;
  sequence: number;
  academicYearId: string;
  academicYearName: string;
}

export interface PromotionCandidateDto {
  studentId: string;
  admissionNumber: string;
  /** "Surname Firstname" — assembled server-side so every surface agrees. */
  displayName: string;
  /** The student's own lifecycle status (ACTIVE, WITHDRAWN, …). */
  studentStatus: string;

  sourceEnrollmentId: string;
  sourceClassLevelId: string;
  sourceClassLevelName: string;
  sourceClassArmId: string;
  sourceClassArmName: string;
  /** Position of the source arm within its level, 0-based, by code ASC. */
  sourceArmIndex: number;
  sourceStatus: EnrollmentStatusDto;

  proposedAction: PromotionAction;
  /** Destination arm for PROMOTE. Null when blocked or proposed GRADUATE. */
  proposedClassArmId: string | null;
  proposedClassArmName: string | null;
  destinationClassLevelId: string | null;
  destinationClassLevelName: string | null;

  blockReason: PromotionBlockReason | null;
}

/**
 * One source arm whose students have nowhere to land. The admin resolves it
 * before those rows can be promoted — by creating the suggested arm (the
 * ordinary POST /class-levels/:id/class-arms endpoint; this module creates
 * nothing itself) or by pointing the rows at an arm that already exists.
 */
export interface PromotionArmGapDto {
  sourceClassArmId: string;
  sourceClassArmName: string;
  sourceClassLevelName: string;
  sourceArmIndex: number;
  studentCount: number;
  destinationClassLevelId: string;
  destinationClassLevelName: string;
  /** Name/code we would use if the admin asks us to create the arm. */
  suggestedArmName: string;
  suggestedArmCode: string;
  /** Arms that DO exist in the destination level, as the alternative. */
  existingDestinationArms: { id: string; name: string }[];
}

export interface PromotionCountsDto {
  promote: number;
  repeat: number;
  graduate: number;
  exclude: number;
  /** Rows carrying a blockReason — a subset of the above, not a fifth bucket. */
  blocked: number;
  total: number;
}

export interface PromotionPreviewDto {
  mode: PromotionMode;
  sourceTerm: PromotionTermRefDto;
  targetTerm: PromotionTermRefDto;
  candidates: PromotionCandidateDto[];
  gaps: PromotionArmGapDto[];
  counts: PromotionCountsDto;
}

export interface PromotionCommitResultDto {
  /** Target-term enrollments created (PROMOTE + REPEAT). */
  enrolled: number;
  /** Students whose source enrollment moved to PROMOTED. */
  promoted: number;
  /** Students whose source enrollment moved to REPEATED. */
  repeated: number;
  /** Students marked GRADUATED (student row AND source enrollment). */
  graduated: number;
  /**
   * Decisions that were valid but wrote nothing because the student already
   * held an enrollment in the target term. This is what makes re-running a
   * half-finished promotion safe, so it is a normal outcome, not an error.
   */
  skipped: number;
  /** Decisions the server refused, each with a machine-readable reason. */
  errors: { studentId: string; reason: string }[];
}
