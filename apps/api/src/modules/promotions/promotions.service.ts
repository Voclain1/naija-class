import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  NotFoundError,
  ValidationError,
  type CommitPromotionInput,
  type PreviewPromotionQuery,
  type PromotionAction,
  type PromotionArmGapDto,
  type PromotionBlockReason,
  type PromotionCandidateDto,
  type PromotionCommitResultDto,
  type PromotionCountsDto,
  type PromotionMode,
  type PromotionPreviewDto,
  type PromotionTermRefDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import {
  armIndexWithinLevel,
  resolveYearDestination,
  suggestArm,
  type LadderArm,
  type LadderLevel,
} from "./promotion-mapping";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

const AUDIT = {
  commit: "promotion.commit",
} as const;

// The commit touches every student in the school in one transaction. The
// default 5s interactive-transaction budget is the one withTenant's P2028
// retry cannot help with (see tenant-client.ts) — a body timeout just re-runs
// the same slow work. Round-trips are kept to a fixed handful (grouped
// updateMany per bucket, one createMany) and the budget is raised rather than
// relied upon.
const COMMIT_TIMEOUT_MS = 30_000;

@Injectable()
export class PromotionsService {
  // ----------------------------------------------------------------------
  // preview — who would move where, for the whole school, in one list.
  //
  // THE STRUCTURAL GUARANTEE THIS MODULE EXISTS FOR: every candidate row is
  // derived from a REAL enrollment in the source term. There is no
  // "all ACTIVE students" query anywhere in this file. The 2026-08-25
  // carry-over incident (docs/runbooks/carry-over-incident-2026-08-25.md) came
  // from a third candidate group built from listStudents({ status: "ACTIVE" }),
  // which at a newly-onboarded school is the entire school. A student who was
  // not enrolled in the source term cannot appear here at all, so that defect
  // is not merely fixed — it is unexpressible.
  // ----------------------------------------------------------------------
  async preview(
    authCtx: AuthContext,
    query: PreviewPromotionQuery,
  ): Promise<PromotionPreviewDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    if (query.sourceTermId === query.targetTermId) {
      throw new ValidationError(
        "SAME_TERM",
        "The source and target terms must be different.",
      );
    }

    return withTenant(authCtx.schoolId, async (db) => {
      const terms = await db.term.findMany({
        where: { id: { in: [query.sourceTermId, query.targetTermId] } },
        select: TERM_SELECT,
      });
      const source = terms.find((t) => t.id === query.sourceTermId);
      const target = terms.find((t) => t.id === query.targetTermId);
      if (!source) throw new NotFoundError("Source term not found.");
      if (!target) throw new NotFoundError("Target term not found.");

      const mode: PromotionMode =
        source.academicYearId === target.academicYearId
          ? "TERM_ROLL"
          : "YEAR_PROMOTION";

      assertForwardInTime(mode, source, target);

      const [sourceEnrollments, levels, arms, targetEnrollments] =
        await Promise.all([
          db.enrollment.findMany({
            where: { termId: source.id },
            select: {
              id: true,
              studentId: true,
              classArmId: true,
              status: true,
              student: {
                select: {
                  id: true,
                  admissionNumber: true,
                  firstName: true,
                  lastName: true,
                  status: true,
                },
              },
            },
          }),
          db.classLevel.findMany({
            select: {
              id: true,
              name: true,
              code: true,
              orderIndex: true,
              isActive: true,
            },
          }),
          db.classArm.findMany({
            select: {
              id: true,
              classLevelId: true,
              name: true,
              code: true,
              isActive: true,
            },
          }),
          db.enrollment.findMany({
            where: { termId: target.id },
            select: { studentId: true },
          }),
        ]);

      const ladder: LadderLevel[] = levels;
      const levelById = new Map(levels.map((l) => [l.id, l]));
      const armById = new Map(arms.map((a) => [a.id, a]));
      const armsByLevelId = new Map<string, LadderArm[]>();
      for (const arm of arms) {
        const list = armsByLevelId.get(arm.classLevelId) ?? [];
        list.push(arm);
        armsByLevelId.set(arm.classLevelId, list);
      }
      const alreadyInTarget = new Set(targetEnrollments.map((e) => e.studentId));

      const candidates: PromotionCandidateDto[] = [];
      const gapsByArmId = new Map<string, PromotionArmGapDto>();

      for (const enrollment of sourceEnrollments) {
        const arm = armById.get(enrollment.classArmId);
        const level = arm ? levelById.get(arm.classLevelId) : undefined;
        // An enrollment whose arm or level has been hard-deleted cannot be
        // mapped or displayed honestly. Cascades make this near-impossible;
        // skipping beats inventing a placement.
        if (!arm || !level) continue;

        const armIndex = armIndexWithinLevel(
          armsByLevelId.get(level.id) ?? [],
          arm.id,
        );

        const destination =
          mode === "YEAR_PROMOTION"
            ? resolveYearDestination(ladder, armsByLevelId, level.id, armIndex)
            : // TERM_ROLL — the student stays exactly where they are. The only
              // way this fails is an arm retired mid-year, which is a real
              // decision for the admin rather than one to guess at.
              arm.isActive
              ? ({ kind: "ARM" as const, level, arm })
              : ({ kind: "NO_ARM" as const, level });

        const { action, blockReason } = proposeAction({
          alreadyEnrolled: alreadyInTarget.has(enrollment.studentId),
          studentStatus: enrollment.student.status,
          sourceStatus: enrollment.status,
          destinationKind: destination.kind,
        });

        const placed = destination.kind === "ARM" && action === "PROMOTE";

        candidates.push({
          studentId: enrollment.studentId,
          admissionNumber: enrollment.student.admissionNumber,
          displayName:
            `${enrollment.student.lastName} ${enrollment.student.firstName}`.trim(),
          studentStatus: enrollment.student.status,
          sourceEnrollmentId: enrollment.id,
          sourceClassLevelId: level.id,
          sourceClassLevelName: level.name,
          sourceClassArmId: arm.id,
          sourceClassArmName: arm.name,
          sourceArmIndex: armIndex,
          sourceStatus: enrollment.status,
          proposedAction: action,
          proposedClassArmId: placed ? destination.arm.id : null,
          proposedClassArmName: placed ? destination.arm.name : null,
          destinationClassLevelId:
            destination.kind === "NO_LEVEL" ? null : destination.level.id,
          destinationClassLevelName:
            destination.kind === "NO_LEVEL" ? null : destination.level.name,
          blockReason,
        });

        if (destination.kind === "NO_ARM" && blockReason === "NO_DESTINATION_ARM") {
          const existing = gapsByArmId.get(arm.id);
          if (existing) {
            existing.studentCount += 1;
          } else {
            const suggestion = suggestArm(destination.level, level, arm);
            gapsByArmId.set(arm.id, {
              sourceClassArmId: arm.id,
              sourceClassArmName: arm.name,
              sourceClassLevelName: level.name,
              sourceArmIndex: armIndex,
              studentCount: 1,
              destinationClassLevelId: destination.level.id,
              destinationClassLevelName: destination.level.name,
              suggestedArmName: suggestion.name,
              suggestedArmCode: suggestion.code,
              existingDestinationArms: (
                armsByLevelId.get(destination.level.id) ?? []
              )
                .filter((a) => a.isActive)
                .sort((a, b) => a.code.localeCompare(b.code))
                .map((a) => ({ id: a.id, name: a.name })),
            });
          }
        }
      }

      candidates.sort(compareCandidates(levelById));

      return {
        mode,
        sourceTerm: toTermRef(source),
        targetTerm: toTermRef(target),
        candidates,
        gaps: [...gapsByArmId.values()],
        counts: countActions(candidates),
      };
    });
  }

  // ----------------------------------------------------------------------
  // commit — one approval, the whole school.
  //
  // Every decision is EXPLICIT. The server re-reads the source term and
  // refuses any studentId that does not hold an enrollment in it, so a stale
  // or hand-crafted payload cannot enrol somebody the preview never showed.
  // The destination arm is likewise always supplied by the caller and always
  // re-validated here: nothing is defaulted at write time.
  //
  // Idempotent. A student already enrolled in the target term is counted in
  // `skipped` and nothing is written for them, so re-running an interrupted
  // commit is safe and is the documented recovery path.
  // ----------------------------------------------------------------------
  async commit(
    authCtx: AuthContext,
    input: CommitPromotionInput,
    reqCtx: RequestContext,
  ): Promise<PromotionCommitResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    if (input.sourceTermId === input.targetTermId) {
      throw new ValidationError(
        "SAME_TERM",
        "The source and target terms must be different.",
      );
    }

    const duplicates = findDuplicateStudentIds(input.decisions);
    if (duplicates.length > 0) {
      throw new ValidationError(
        "DUPLICATE_DECISION",
        `Each student may appear once. Repeated: ${duplicates.slice(0, 5).join(", ")}.`,
      );
    }

    const graduating = input.decisions.filter((d) => d.action === "GRADUATE");
    if (graduating.length > 0 && input.confirmGraduations !== true) {
      throw new ValidationError(
        "GRADUATIONS_NOT_CONFIRMED",
        "This promotion graduates students, which marks them as having left the school. Confirm the graduations to continue.",
      );
    }

    return withTenant(
      authCtx.schoolId,
      async (db) => {
        const terms = await db.term.findMany({
          where: { id: { in: [input.sourceTermId, input.targetTermId] } },
          select: TERM_SELECT,
        });
        const source = terms.find((t) => t.id === input.sourceTermId);
        const target = terms.find((t) => t.id === input.targetTermId);
        if (!source) throw new NotFoundError("Source term not found.");
        if (!target) throw new NotFoundError("Target term not found.");

        const mode: PromotionMode =
          source.academicYearId === target.academicYearId
            ? "TERM_ROLL"
            : "YEAR_PROMOTION";
        assertForwardInTime(mode, source, target);

        const studentIds = input.decisions.map((d) => d.studentId);
        const requestedArmIds = [
          ...new Set(
            input.decisions
              .map((d) => d.classArmId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];

        const [sourceEnrollments, targetEnrollments, destinationArms] =
          await Promise.all([
            db.enrollment.findMany({
              where: { termId: source.id, studentId: { in: studentIds } },
              select: {
                id: true,
                studentId: true,
                classArmId: true,
                classArm: { select: { id: true, classLevelId: true } },
              },
            }),
            db.enrollment.findMany({
              where: { termId: target.id, studentId: { in: studentIds } },
              select: { studentId: true },
            }),
            db.classArm.findMany({
              where: { id: { in: requestedArmIds } },
              select: { id: true, classLevelId: true, isActive: true },
            }),
          ]);

        const sourceByStudent = new Map(
          sourceEnrollments.map((e) => [e.studentId, e]),
        );
        const alreadyInTarget = new Set(
          targetEnrollments.map((e) => e.studentId),
        );
        const armById = new Map(destinationArms.map((a) => [a.id, a]));

        const errors: PromotionCommitResultDto["errors"] = [];
        const toEnrol: {
          studentId: string;
          classArmId: string;
          promotedFromArmId: string;
        }[] = [];
        const promotedEnrollmentIds: string[] = [];
        const repeatedEnrollmentIds: string[] = [];
        const graduatedEnrollmentIds: string[] = [];
        const graduatedStudentIds: string[] = [];
        let skipped = 0;

        for (const decision of input.decisions) {
          if (decision.action === "EXCLUDE") continue;

          const sourceEnrollment = sourceByStudent.get(decision.studentId);
          if (!sourceEnrollment) {
            // The load-bearing refusal. Without it, a payload naming any
            // student id at all would enrol them — which is the shape of the
            // August incident, moved from the browser to the wire.
            errors.push({
              studentId: decision.studentId,
              reason: "No enrollment in the source term.",
            });
            continue;
          }

          if (decision.action === "GRADUATE") {
            graduatedEnrollmentIds.push(sourceEnrollment.id);
            graduatedStudentIds.push(decision.studentId);
            continue;
          }

          if (alreadyInTarget.has(decision.studentId)) {
            skipped += 1;
            continue;
          }

          const arm = decision.classArmId
            ? armById.get(decision.classArmId)
            : undefined;
          if (!arm) {
            errors.push({
              studentId: decision.studentId,
              reason: "Destination class arm not found.",
            });
            continue;
          }
          if (!arm.isActive) {
            errors.push({
              studentId: decision.studentId,
              reason: "Destination class arm is inactive.",
            });
            continue;
          }
          if (
            decision.action === "REPEAT" &&
            arm.classLevelId !== sourceEnrollment.classArm.classLevelId
          ) {
            // Repeating means doing the same class again. A "repeat" into a
            // different level is a promotion (or a demotion) wearing the wrong
            // label, and the audit trail would then lie about what happened.
            errors.push({
              studentId: decision.studentId,
              reason: "A repeating student must stay in the same class level.",
            });
            continue;
          }

          toEnrol.push({
            studentId: decision.studentId,
            classArmId: arm.id,
            promotedFromArmId: sourceEnrollment.classArmId,
          });
          if (decision.action === "REPEAT") {
            repeatedEnrollmentIds.push(sourceEnrollment.id);
          } else if (mode === "YEAR_PROMOTION") {
            promotedEnrollmentIds.push(sourceEnrollment.id);
          }
          // TERM_ROLL leaves the source enrollment ENROLLED: carrying a child
          // into next term does not end their standing in this one.
        }

        const created = await db.enrollment.createMany({
          data: toEnrol.map((row) => ({
            schoolId: authCtx.schoolId,
            studentId: row.studentId,
            termId: target.id,
            academicYearId: target.academicYearId,
            classArmId: row.classArmId,
            promotedFromArmId: row.promotedFromArmId,
            status: "ENROLLED" as const,
          })),
          skipDuplicates: true,
        });

        if (promotedEnrollmentIds.length > 0) {
          await db.enrollment.updateMany({
            where: { id: { in: promotedEnrollmentIds } },
            data: { status: "PROMOTED" },
          });
        }
        if (repeatedEnrollmentIds.length > 0) {
          await db.enrollment.updateMany({
            where: { id: { in: repeatedEnrollmentIds } },
            data: { status: "REPEATED" },
          });
        }
        if (graduatedEnrollmentIds.length > 0) {
          await db.enrollment.updateMany({
            where: { id: { in: graduatedEnrollmentIds } },
            data: { status: "GRADUATED" },
          });
          // Mirrors StudentsService.graduate: the student's own lifecycle
          // status is what every other surface reads, so a graduation that
          // only moved the enrollment row would leave leavers on the roster.
          // WITHDRAWN students are left alone — that transition is rejected
          // there too, and a bulk screen is the wrong place to override it.
          await db.student.updateMany({
            where: {
              id: { in: graduatedStudentIds },
              status: { notIn: ["GRADUATED", "WITHDRAWN"] },
            },
            data: { status: "GRADUATED", graduatedAt: new Date() },
          });
        }

        const result: PromotionCommitResultDto = {
          enrolled: created.count,
          promoted: promotedEnrollmentIds.length,
          repeated: repeatedEnrollmentIds.length,
          graduated: graduatedEnrollmentIds.length,
          skipped,
          errors,
        };

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.commit,
            entityType: "enrollment",
            // Anchored at the TARGET term — the thing that now holds new rows.
            // Matches enrollment.bulk-create's choice so both roll-forward
            // actions are found by the same audit query.
            entityId: target.id,
            ipAddress: reqCtx.ipAddress,
            metadata: {
              mode,
              sourceTermId: source.id,
              targetTermId: target.id,
              decisions: input.decisions.length,
              enrolled: result.enrolled,
              promoted: result.promoted,
              repeated: result.repeated,
              graduated: result.graduated,
              skipped: result.skipped,
              errors: errors.length,
            },
          },
        });

        return result;
      },
      { timeoutMs: COMMIT_TIMEOUT_MS, label: "promotions.commit" },
    );
  }
}

// -------------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------------

const TERM_SELECT = {
  id: true,
  name: true,
  sequence: true,
  academicYearId: true,
  academicYear: { select: { id: true, label: true, startDate: true } },
} as const;

interface TermRow {
  id: string;
  name: string;
  sequence: number;
  academicYearId: string;
  academicYear: { id: string; label: string; startDate: Date };
}

function toTermRef(term: TermRow): PromotionTermRefDto {
  return {
    id: term.id,
    name: term.name,
    sequence: term.sequence,
    academicYearId: term.academicYearId,
    academicYearName: term.academicYear.label,
  };
}

/**
 * A promotion only ever runs forwards. Rolling backwards would write
 * enrollments into a closed term and, in year mode, promote children into a
 * class they have already left.
 */
function assertForwardInTime(
  mode: PromotionMode,
  source: TermRow,
  target: TermRow,
): void {
  if (mode === "TERM_ROLL") {
    if (target.sequence <= source.sequence) {
      throw new ValidationError(
        "BACKWARD_TERM",
        "The target term must come after the source term.",
      );
    }
    return;
  }
  if (
    target.academicYear.startDate.getTime() <=
    source.academicYear.startDate.getTime()
  ) {
    throw new ValidationError(
      "BACKWARD_YEAR",
      "The target academic year must come after the source academic year.",
    );
  }
}

function proposeAction(args: {
  alreadyEnrolled: boolean;
  studentStatus: string;
  sourceStatus: string;
  destinationKind: "ARM" | "NO_ARM" | "NO_LEVEL";
}): { action: PromotionAction; blockReason: PromotionBlockReason | null } {
  // Order matters: each rule below is a reason NOT to move a child, and the
  // first one that applies is the one the admin most needs to see.
  if (args.alreadyEnrolled) {
    return { action: "EXCLUDE", blockReason: "ALREADY_ENROLLED" };
  }
  if (args.studentStatus !== "ACTIVE") {
    // Withdrawn, graduated, suspended or inactive students are listed (so the
    // admin sees the whole class) but never moved by default.
    return { action: "EXCLUDE", blockReason: null };
  }
  if (args.sourceStatus !== "ENROLLED") {
    // The child's standing in the source term was already closed out —
    // transferred away, withdrawn, or previously rolled.
    return { action: "EXCLUDE", blockReason: null };
  }
  if (args.destinationKind === "NO_LEVEL") {
    // Top of the ladder. Proposed, never applied without the separate
    // graduation confirmation at commit.
    return { action: "GRADUATE", blockReason: "NO_DESTINATION_LEVEL" };
  }
  if (args.destinationKind === "NO_ARM") {
    return { action: "EXCLUDE", blockReason: "NO_DESTINATION_ARM" };
  }
  return { action: "PROMOTE", blockReason: null };
}

function compareCandidates(levelById: Map<string, { orderIndex: number }>) {
  return (a: PromotionCandidateDto, b: PromotionCandidateDto): number => {
    const ao = levelById.get(a.sourceClassLevelId)?.orderIndex ?? 0;
    const bo = levelById.get(b.sourceClassLevelId)?.orderIndex ?? 0;
    if (ao !== bo) return ao - bo;
    if (a.sourceArmIndex !== b.sourceArmIndex)
      return a.sourceArmIndex - b.sourceArmIndex;
    return a.displayName.localeCompare(b.displayName);
  };
}

function countActions(rows: PromotionCandidateDto[]): PromotionCountsDto {
  const counts: PromotionCountsDto = {
    promote: 0,
    repeat: 0,
    graduate: 0,
    exclude: 0,
    blocked: 0,
    total: rows.length,
  };
  for (const row of rows) {
    if (row.proposedAction === "PROMOTE") counts.promote += 1;
    else if (row.proposedAction === "REPEAT") counts.repeat += 1;
    else if (row.proposedAction === "GRADUATE") counts.graduate += 1;
    else counts.exclude += 1;
    if (row.blockReason !== null) counts.blocked += 1;
  }
  return counts;
}

function findDuplicateStudentIds(decisions: { studentId: string }[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const d of decisions) {
    if (seen.has(d.studentId)) dupes.add(d.studentId);
    seen.add(d.studentId);
  }
  return [...dupes];
}
