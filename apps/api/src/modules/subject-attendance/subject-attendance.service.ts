import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type SubjectAttendanceMarkInput,
  type SubjectAttendanceMarkResultDto,
  type SubjectAttendanceRegisterQuery,
  type SubjectAttendanceRegisterResponse,
  type SubjectAttendanceRegisterRowDto,
  type SubjectAttendanceSummaryQuery,
  type SubjectAttendanceSummaryResponse,
  type SubjectAttendanceSummaryRowDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import {
  fullName,
  loadRoster,
  parseIsoDate,
  rateHundredths,
  resolveTermForDate,
  STUDENT_NAME_SELECT,
  type TenantDb,
} from "../attendance/shared/attendance-shared.util.js";
import { getTeacherScope } from "../teacher-scope/teacher-scope.helper";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Audit-action naming — singular resource, dotted verb (locked in slice 1).
const AUDIT = {
  mark: "subject-attendance.mark",
} as const;

@Injectable()
export class SubjectAttendanceService {
  // =========================================================================
  // GET /subject-attendance/register?classArmId=&subjectId=&date=&period= — the
  // (subject, date, period) register for one arm: every student enrolled by
  // `date`, merged with whatever marks exist for that exact period.
  // =========================================================================
  async getRegister(
    authCtx: AuthContext,
    query: SubjectAttendanceRegisterQuery,
  ): Promise<SubjectAttendanceRegisterResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertEnabled(db, authCtx.schoolId);
      await this.assertCanMarkSubject(db, authCtx, query.classArmId, query.subjectId);

      const dateObj = parseIsoDate(query.date);
      const term = await resolveTermForDate(db, dateObj);
      const roster = await loadRoster(db, query.classArmId, term.id, dateObj);

      const marks = await db.subjectAttendanceRecord.findMany({
        where: {
          classArmId: query.classArmId,
          subjectId: query.subjectId,
          date: dateObj,
          period: query.period,
        },
        select: { studentId: true, status: true, note: true, markedBy: true, markedAt: true },
      });
      const marksByStudent = new Map(marks.map((m) => [m.studentId, m]));

      const records: SubjectAttendanceRegisterRowDto[] = roster.map((s) => {
        const mark = marksByStudent.get(s.id);
        return {
          studentId: s.id,
          fullName: fullName(s),
          admissionNumber: s.admissionNumber,
          status: mark?.status ?? null,
          note: mark?.note ?? null,
          markedBy: mark?.markedBy ?? null,
          markedAt: mark?.markedAt ?? null,
        };
      });

      return {
        date: query.date,
        classArmId: query.classArmId,
        subjectId: query.subjectId,
        period: query.period,
        termId: term.id,
        records,
      };
    });
  }

  // =========================================================================
  // POST /subject-attendance/mark — upsert one (subject, date, period) register.
  // Atomic all-or-nothing in one withTenant tx: opt-in gate, scope gate, roster
  // validation, then upsert each on (school, student, subject, date, period).
  // =========================================================================
  async markBulk(
    authCtx: AuthContext,
    input: SubjectAttendanceMarkInput,
    reqCtx: RequestContext,
  ): Promise<SubjectAttendanceMarkResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertEnabled(db, authCtx.schoolId);
      await this.assertCanMarkSubject(db, authCtx, input.classArmId, input.subjectId);

      const dateObj = parseIsoDate(input.date);
      const term = await resolveTermForDate(db, dateObj);

      // One student may appear at most once per submit — a dup would silently
      // collapse in the upsert loop and miscount.
      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const r of input.records) {
        if (seen.has(r.studentId)) duplicates.add(r.studentId);
        seen.add(r.studentId);
      }
      if (duplicates.size > 0) {
        throw new ValidationError("Each student may appear only once per submission.", {
          duplicateStudentIds: [...duplicates],
        });
      }

      // Every submitted student must be on this register (enrolled in the arm by
      // `date`). Reject the whole batch otherwise — the client sent a stale roster.
      const roster = await loadRoster(db, input.classArmId, term.id, dateObj);
      const rosterIds = new Set(roster.map((s) => s.id));
      const invalid = input.records.map((r) => r.studentId).filter((id) => !rosterIds.has(id));
      if (invalid.length > 0) {
        throw new ValidationError("Some students are not on this register.", {
          invalidStudentIds: invalid,
        });
      }

      const byStatus = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
      for (const r of input.records) {
        byStatus[r.status] += 1;
        await db.subjectAttendanceRecord.upsert({
          where: {
            schoolId_studentId_subjectId_date_period: {
              schoolId: authCtx.schoolId,
              studentId: r.studentId,
              subjectId: input.subjectId,
              date: dateObj,
              period: input.period,
            },
          },
          create: {
            schoolId: authCtx.schoolId,
            studentId: r.studentId,
            classArmId: input.classArmId,
            subjectId: input.subjectId,
            termId: term.id,
            date: dateObj,
            period: input.period,
            status: r.status,
            note: r.note ?? null,
            markedBy: authCtx.userId,
          },
          update: {
            status: r.status,
            note: r.note ?? null,
            classArmId: input.classArmId,
            termId: term.id,
            markedBy: authCtx.userId,
          },
        });
      }

      await this.writeAudit(db, authCtx, reqCtx, AUDIT.mark, "subject_attendance", input.classArmId, {
        classArmId: input.classArmId,
        subjectId: input.subjectId,
        termId: term.id,
        date: input.date,
        period: input.period,
        count: input.records.length,
        byStatus,
      });

      return { count: input.records.length };
    });
  }

  // =========================================================================
  // GET /subject-attendance/summary?classArmId=&subjectId=&termId= — per-student
  // stats for the (arm, subject, term), aggregated by PERIOD record. Built from
  // the records themselves (NOT the current roster) so a transferred/withdrawn
  // student still surfaces with their history (queried by termId).
  // =========================================================================
  async getSummary(
    authCtx: AuthContext,
    query: SubjectAttendanceSummaryQuery,
  ): Promise<SubjectAttendanceSummaryResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertEnabled(db, authCtx.schoolId);
      await this.assertCanMarkSubject(db, authCtx, query.classArmId, query.subjectId);

      const term = await db.term.findUnique({ where: { id: query.termId }, select: { id: true } });
      if (!term) throw new NotFoundError("Term not found.");

      const records = await db.subjectAttendanceRecord.findMany({
        where: { classArmId: query.classArmId, subjectId: query.subjectId, termId: query.termId },
        select: { studentId: true, date: true, period: true, status: true },
      });

      // Tally per student + the distinct operating days / (date, period) slots.
      const tallies = new Map<
        string,
        { periodsMarked: number; present: number; absent: number; late: number; excused: number }
      >();
      const operatingDays = new Set<number>();
      const operatingPeriods = new Set<string>();
      for (const r of records) {
        operatingDays.add(r.date.getTime());
        operatingPeriods.add(`${r.date.getTime()}:${r.period}`);
        const t =
          tallies.get(r.studentId) ??
          { periodsMarked: 0, present: 0, absent: 0, late: 0, excused: 0 };
        t.periodsMarked += 1;
        if (r.status === "PRESENT") t.present += 1;
        else if (r.status === "ABSENT") t.absent += 1;
        else if (r.status === "LATE") t.late += 1;
        else t.excused += 1;
        tallies.set(r.studentId, t);
      }

      const students = await db.student.findMany({
        where: { id: { in: [...tallies.keys()] } },
        select: STUDENT_NAME_SELECT,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      });

      const summary: SubjectAttendanceSummaryRowDto[] = students.map((s) => {
        const t = tallies.get(s.id)!;
        return {
          studentId: s.id,
          fullName: fullName(s),
          admissionNumber: s.admissionNumber,
          periodsMarked: t.periodsMarked,
          presentCount: t.present,
          absentCount: t.absent,
          lateCount: t.late,
          excusedCount: t.excused,
          // (PRESENT + LATE) / periodsMarked, Int hundredths. EXCUSED stays in
          // the denominator as not-attended (policy i).
          attendanceRate: rateHundredths(t.present + t.late, t.periodsMarked),
        };
      });

      const subjectAttendanceRate =
        summary.length > 0
          ? Math.round(summary.reduce((sum, r) => sum + r.attendanceRate, 0) / summary.length)
          : 0;

      return {
        classArmId: query.classArmId,
        subjectId: query.subjectId,
        termId: query.termId,
        summary,
        armSummary: {
          totalDaysOperated: operatingDays.size,
          totalPeriodsOperated: operatingPeriods.size,
          subjectAttendanceRate,
        },
      };
    });
  }

  // -------------------------------------------------------------------------
  // Opt-in gate — the WHOLE surface 404s until the school enables it. First
  // check on every endpoint, before scope, so even owner/admin get 404 (the
  // feature genuinely doesn't exist for the school yet). schools is not under
  // RLS, so this findUnique resolves regardless of the tenant GUC.
  // -------------------------------------------------------------------------
  private async assertEnabled(db: TenantDb, schoolId: string): Promise<void> {
    const school = await db.school.findUnique({
      where: { id: schoolId },
      select: { subjectAttendanceEnabled: true },
    });
    if (!school?.subjectAttendanceEnabled) {
      throw new NotFoundError("Not found.");
    }
  }

  // -------------------------------------------------------------------------
  // Scope gate — subject-period attendance is marked by the teacher of THAT
  // (arm, subject), not the form teacher. Built on getTeacherScope (the same
  // primitive score-entry uses). A teacher in the arm's scope but not assigned
  // this subject → 403 (incl. a form teacher with no subject assignment here);
  // an arm wholly out of scope → 404 (invisible, same as cross-tenant).
  // -------------------------------------------------------------------------
  private async assertCanMarkSubject(
    db: TenantDb,
    authCtx: AuthContext,
    classArmId: string,
    subjectId: string,
  ): Promise<void> {
    const roleKeys = await this.resolveRoleKeys(db, authCtx.userId);
    if (roleKeys.includes("owner") || roleKeys.includes("admin")) return;

    const scope = await getTeacherScope(db, authCtx.userId);
    const subjects = scope.subjectsByArm.get(classArmId) ?? [];
    if (subjects.some((s) => s.id === subjectId)) return; // teaches this arm+subject ✓
    if (scope.classArms.some((a) => a.id === classArmId)) {
      // In the arm's scope (teaches another subject here, or form teacher) but
      // not assigned THIS subject.
      throw new ForbiddenError("You are not assigned this subject for this class.");
    }
    throw new NotFoundError("Class arm not found.");
  }

  private async resolveRoleKeys(db: TenantDb, userId: string): Promise<string[]> {
    const grants = await db.userRole.findMany({
      where: { userId },
      select: { role: { select: { key: true } } },
    });
    return grants.map((g) => g.role.key);
  }

  private async writeAudit(
    db: TenantDb,
    authCtx: AuthContext,
    reqCtx: RequestContext,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        schoolId: authCtx.schoolId,
        userId: authCtx.userId,
        action,
        entityType,
        entityId,
        ipAddress: reqCtx.ipAddress,
        metadata,
      },
    });
  }
}
