import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import type {
  SetupReadyItemDto,
  SetupStateDto,
  SetupStepDto,
  SetupStepKey,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";

// ---------------------------------------------------------------------------
// SetupStateService — the source of truth for "where is this school in its
// first-time setup?" (F-25).
//
// EVERY FIELD IS A LIVE COUNT. Nothing here is stored, cached, or stamped;
// there is no setup_progress table and no client-side completion flag. That
// is the whole design: a school that added its students by CSV import, or
// whose bursar priced the fee catalogue from a different session, is simply
// already complete the next time this runs. There is nothing to reconcile
// because there is nothing to disagree with.
//
// THE TIERS ARE THE POINT, not the checklist. The audit finding was not "no
// checklist exists" — it was that the product never distinguished a true
// blocker from a nice-to-have, so an owner had no way to tell which of a
// dozen settings screens they had to visit before the app would work. Each
// tier below is justified against real code, not product intuition:
//
//   required — the workflow is inert without it.
//     - academic-calendar: Enrollment.create resolves academicYearId from a
//       Term (enrollments.service.ts), InvoiceGenerationService.fetchTerm and
//       AttendanceService both take a termId, and DashboardService 404s on a
//       missing term. Normally already true: onboarding step 5 collects it
//       and is not skippable. Kept as a step anyway so pre-step-5 schools
//       (the 2026-08-21 census cohort) see it in the same list as everything
//       else, and so a healthy school gets to see one row already ticked.
//     - students: nothing downstream has a subject without them.
//     - enrollments: THE step nobody knows about. A Student row alone puts
//       nobody on a register — the attendance register, the arm invoice run,
//       the teacher roster and the report-card build all read Enrollment,
//       not Student. Adding students and then finding every class still
//       empty is the single sharpest dead end in the fresh-school walk.
//
//   recommended — one named workflow is unavailable; the school still runs.
//     - fee-catalog: with no active FeeItem, GET /invoices/arm/preview
//       returns [] and the generate run bills nothing — successfully, and
//       silently. Not "required" because a school can legitimately run
//       rosters and attendance while collecting fees offline.
//     - staff: an owner can do all admin work alone; teachers are needed
//       before anyone else can mark a register or enter a score.
//     - form-teachers: AttendanceService.assertCanAccessArmAttendance lets
//       owner/admin mark any arm, but a TEACHER may only mark the arm they
//       are form teacher of. So this blocks teacher-marked attendance
//       specifically — not attendance itself.
//     - teacher-assignments: TeacherScopeService.getMyScope is built from
//       TeacherAssignment rows; an unassigned teacher's gradebook is empty.
//
//   optional — nothing is blocked today.
//     - class-subjects: verified 2026-08-29 by grepping every consumer —
//       `ClassSubject` is read by its own CRUD module and by nothing else in
//       apps/ or packages/. It does not gate the gradebook, report cards, or
//       teacher assignment (TeacherAssignmentsService validates that the
//       subject is active, never that it is linked to the level).
//       docs/onboarding-guide.md lists it at stage 6, which reads as a
//       prerequisite; it is not one yet, and this list says so rather than
//       repeating the implication.
//     - guardians: the parent portal is a feature a school opts into.
//
// WHAT IS DELIBERATELY NOT A STEP. Class levels, class arms, the subject
// catalogue and the grading scheme are all seeded at signup by
// applySchoolDefaults() — 14 levels, one arm each, 3 core subjects, a
// WAEC-style scheme with components and boundaries. Putting them on a
// to-do list would ask an owner to do work that is already done. They are
// returned as `alreadyDone` instead, because "what is already complete" is
// one of the four questions this feature has to answer.
// ---------------------------------------------------------------------------
@Injectable()
export class SetupStateService {
  async getSetupState(authCtx: AuthContext): Promise<SetupStateDto> {
    // Owner/admin only. Every action in this list is one of those two roles'
    // to perform — a bursar or teacher shown "invite your teachers" would be
    // handed a button that 403s. Gated in the service, matching how
    // SchoolsController's own onboarding handlers gate.
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const currentTerm = await db.term.findFirst({
        where: { isCurrent: true },
        select: { id: true },
      });

      const [
        studentCount,
        enrolledCount,
        feeItemCount,
        teacherUserCount,
        pendingTeacherInviteCount,
        formTeacherArmCount,
        teacherAssignmentCount,
        classSubjectCount,
        guardianCount,
        attendanceCount,
        invoiceCount,
        scoreCount,
      ] = await Promise.all([
        db.student.count({ where: { status: "ACTIVE" } }),
        currentTerm
          ? db.enrollment.count({ where: { termId: currentTerm.id, status: "ENROLLED" } })
          : Promise.resolve(0),
        db.feeItem.count({ where: { active: true } }),
        db.user.count({
          where: { isActive: true, roles: { some: { role: { key: "teacher" } } } },
        }),
        // A teacher who has been invited but has not accepted yet counts: the
        // owner has done their part, and re-prompting them to "invite your
        // teachers" while an invitation is live would be telling them to do
        // it twice.
        db.invitation.count({
          where: { roleKey: "teacher", acceptedAt: null, expiresAt: { gt: new Date() } },
        }),
        db.classArm.count({ where: { isActive: true, classTeacherId: { not: null } } }),
        db.teacherAssignment.count({ where: { isActive: true } }),
        db.classSubject.count(),
        db.guardian.count(),
        // -- real-activity probes ------------------------------------------
        // Deliberately three different workflows, not one: a school that
        // runs registers but bills offline is just as established as one
        // that invoices but has not started entering scores. Any single one
        // is enough.
        db.attendanceRecord.count(),
        db.invoice.count(),
        db.assessmentScore.count(),
      ]);

      const hasRealActivity = attendanceCount > 0 || invoiceCount > 0 || scoreCount > 0;
      const hasTeachers = teacherUserCount > 0 || pendingTeacherInviteCount > 0;

      const steps: SetupStepDto[] = [
        {
          key: "academic-calendar",
          tier: "required",
          done: currentTerm !== null,
          count: currentTerm ? 1 : 0,
          title: "Set your school year and terms",
          why: "Everything in School Kit happens inside a term. Until one is set, you cannot enrol a student, issue an invoice, or mark a register.",
          href: "/settings/academic/years",
          actionLabel: "Set up school year",
        },
        {
          key: "students",
          tier: "required",
          done: studentCount > 0,
          count: studentCount,
          title: "Add your students",
          why: "Your roster is what the rest of the system is built on. Add them one at a time, several in a grid, or import your whole register from a CSV.",
          href: "/students",
          actionLabel: "Add students",
        },
        {
          key: "enrollments",
          tier: "required",
          done: enrolledCount > 0,
          count: enrolledCount,
          // The wording carries the actual lesson: a student on the roster is
          // not yet in a class. This is the step whose absence looks like a
          // bug on four other screens.
          title: "Put your students in their classes for this term",
          why: "Adding a student to the roster does not place them in a class. Registers, invoices, and report cards all work off this term's class lists — until you enrol students, every class shows as empty.",
          href: "/enrollments",
          actionLabel: "Enrol students",
        },
        {
          key: "fee-catalog",
          tier: "recommended",
          done: feeItemCount > 0,
          count: feeItemCount,
          title: "Set your fees",
          why: "Invoices are built from your fee list. With nothing priced, a fee run for a class finishes without billing anybody.",
          href: "/finance/fees",
          actionLabel: "Set up fees",
        },
        {
          key: "staff",
          tier: "recommended",
          done: hasTeachers,
          count: teacherUserCount + pendingTeacherInviteCount,
          title: "Invite your teachers",
          why: "You can run the school on your own, but teachers need their own accounts before they can mark registers or enter scores.",
          href: "/staff",
          actionLabel: "Invite staff",
        },
        {
          key: "form-teachers",
          tier: "recommended",
          done: formTeacherArmCount > 0,
          count: formTeacherArmCount,
          title: "Choose a form teacher for each class",
          why: "Only a class's form teacher can mark its daily register. You and your admins can always mark any class yourselves, so this is about handing that work over.",
          href: "/settings/academic/class-arms",
          actionLabel: "Assign form teachers",
        },
        {
          key: "teacher-assignments",
          tier: "recommended",
          done: teacherAssignmentCount > 0,
          count: teacherAssignmentCount,
          title: "Say who teaches what",
          why: "A teacher's gradebook shows only the classes and subjects they are assigned to. Without assignments, they log in to an empty screen.",
          href: "/staff",
          actionLabel: "Assign teachers",
        },
        {
          key: "class-subjects",
          tier: "optional",
          done: classSubjectCount > 0,
          count: classSubjectCount,
          title: "Record which classes take which subjects",
          why: "A reference list of your curriculum. Nothing is blocked without it — teachers are assigned to subjects directly.",
          href: "/settings/academic/class-subjects",
          actionLabel: "Open the subject matrix",
        },
        {
          key: "guardians",
          tier: "optional",
          done: guardianCount > 0,
          count: guardianCount,
          title: "Add parents and guardians",
          why: "Needed only when you are ready to let parents see results and pay online. You can do this at any time.",
          href: "/guardians/import",
          actionLabel: "Add guardians",
        },
      ];

      const alreadyDone: SetupReadyItemDto[] = [
        {
          label: "Your classes are ready",
          detail:
            "KG 1 through SSS 3, with one class each. Rename them, remove any you do not run, or add more streams whenever you like.",
          href: "/settings/academic/class-arms",
        },
        {
          label: "Grading is ready",
          detail:
            "A WAEC-style scheme — First CA, Second CA and Exam at 20/20/60, with A1 to F9 bands.",
          href: "/settings/grading",
        },
        {
          label: "Core subjects are ready",
          detail:
            "English Language, Mathematics and Civic Education. Add the rest of your subjects when you need them.",
          href: "/settings/academic/subjects",
        },
      ];

      const requiredRemaining = steps.filter((s) => s.tier === "required" && !s.done).length;
      const recommendedRemaining = steps.filter(
        (s) => s.tier === "recommended" && !s.done,
      ).length;
      const nextStepKey: SetupStepKey | null =
        steps.find((s) => !s.done && s.tier !== "optional")?.key ?? null;

      // An outstanding REQUIRED step always shows, activity or not — a school
      // that somehow started marking registers with no current term still
      // needs telling. Otherwise real activity ends the setup UI: that, and
      // not a dismiss button, is what keeps an established school from
      // carrying this around forever.
      const status: SetupStateDto["status"] =
        requiredRemaining > 0
          ? "setup"
          : !hasRealActivity && recommendedRemaining > 0
            ? "finishing"
            : "established";

      return {
        status,
        hasRealActivity,
        steps,
        alreadyDone,
        requiredRemaining,
        recommendedRemaining,
        nextStepKey,
      };
    });
  }
}
