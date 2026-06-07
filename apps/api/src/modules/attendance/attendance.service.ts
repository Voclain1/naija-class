import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type AttendanceMarkInput,
  type AttendanceMarkResultDto,
  type AttendanceRegisterQuery,
  type AttendanceRegisterResponse,
  type AttendanceRegisterRowDto,
  type AttendanceSummaryQuery,
  type AttendanceSummaryResponse,
  type AttendanceSummaryRowDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import { getTeacherScope } from "../teacher-scope/teacher-scope.helper";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Audit-action naming — singular resource, dotted verb (locked in slice 1).
const AUDIT = {
  mark: "attendance.mark",
} as const;

// The tenant-scoped Prisma handle (the `db` passed into withTenant's callback).
type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

const MS_PER_DAY = 86_400_000;

@Injectable()
export class AttendanceService {
  // =========================================================================
  // GET /attendance/register?classArmId=&date= — the day's register for one arm:
  // every student enrolled in the arm by `date`, merged with whatever marks
  // already exist for that day (status null = unmarked).
  // =========================================================================
  async getRegister(
    authCtx: AuthContext,
    query: AttendanceRegisterQuery,
  ): Promise<AttendanceRegisterResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertCanAccessArmAttendance(db, authCtx, query.classArmId);

      const dateObj = this.parseIsoDate(query.date);
      const term = await this.resolveTermForDate(db, dateObj);

      const roster = await this.loadRoster(db, query.classArmId, term.id, dateObj);

      const marks = await db.attendanceRecord.findMany({
        where: { classArmId: query.classArmId, date: dateObj },
        select: { studentId: true, status: true, note: true, markedBy: true, markedAt: true },
      });
      const marksByStudent = new Map(marks.map((m) => [m.studentId, m]));

      const records: AttendanceRegisterRowDto[] = roster.map((s) => {
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

      return { date: query.date, classArmId: query.classArmId, termId: term.id, records };
    });
  }

  // =========================================================================
  // POST /attendance/mark — upsert the day's register. Atomic all-or-nothing in
  // one withTenant tx: validate every row against the roster first, upsert each
  // on (school_id, student_id, date), write ONE audit row with the status tally.
  // =========================================================================
  async markBulk(
    authCtx: AuthContext,
    input: AttendanceMarkInput,
    reqCtx: RequestContext,
  ): Promise<AttendanceMarkResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertCanAccessArmAttendance(db, authCtx, input.classArmId);

      const dateObj = this.parseIsoDate(input.date);
      const term = await this.resolveTermForDate(db, dateObj);

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
      const roster = await this.loadRoster(db, input.classArmId, term.id, dateObj);
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
        await db.attendanceRecord.upsert({
          where: {
            schoolId_studentId_date: {
              schoolId: authCtx.schoolId,
              studentId: r.studentId,
              date: dateObj,
            },
          },
          create: {
            schoolId: authCtx.schoolId,
            studentId: r.studentId,
            classArmId: input.classArmId,
            termId: term.id,
            date: dateObj,
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

      await this.writeAudit(db, authCtx, reqCtx, AUDIT.mark, "attendance", input.classArmId, {
        classArmId: input.classArmId,
        termId: term.id,
        date: input.date,
        count: input.records.length,
        byStatus,
      });

      return { count: input.records.length };
    });
  }

  // =========================================================================
  // GET /attendance/summary?classArmId=&termId= — per-student term stats. Built
  // from the attendance_records themselves (NOT the current roster) so a student
  // who transferred or withdrew mid-term still surfaces here with their history
  // intact (queried by termId, not current enrollment — Q5).
  // =========================================================================
  async getSummary(
    authCtx: AuthContext,
    query: AttendanceSummaryQuery,
  ): Promise<AttendanceSummaryResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertCanAccessArmAttendance(db, authCtx, query.classArmId);

      const term = await db.term.findUnique({ where: { id: query.termId }, select: { id: true } });
      if (!term) throw new NotFoundError("Term not found.");

      const records = await db.attendanceRecord.findMany({
        where: { classArmId: query.classArmId, termId: query.termId },
        select: { studentId: true, date: true, status: true },
      });

      // Tally per student + the set of distinct operating days for the arm.
      const tallies = new Map<
        string,
        { daysMarked: number; present: number; absent: number; late: number; excused: number }
      >();
      const operatingDays = new Set<number>();
      for (const r of records) {
        operatingDays.add(r.date.getTime());
        const t =
          tallies.get(r.studentId) ??
          { daysMarked: 0, present: 0, absent: 0, late: 0, excused: 0 };
        t.daysMarked += 1;
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

      const summary: AttendanceSummaryRowDto[] = students.map((s) => {
        const t = tallies.get(s.id)!;
        return {
          studentId: s.id,
          fullName: fullName(s),
          admissionNumber: s.admissionNumber,
          daysMarked: t.daysMarked,
          presentCount: t.present,
          absentCount: t.absent,
          lateCount: t.late,
          excusedCount: t.excused,
          // (PRESENT + LATE) / daysMarked, Int hundredths. EXCUSED stays in the
          // denominator as not-attended (Q7 policy i).
          attendanceRate: rateHundredths(t.present + t.late, t.daysMarked),
        };
      });

      const armAttendanceRate =
        summary.length > 0
          ? Math.round(summary.reduce((sum, r) => sum + r.attendanceRate, 0) / summary.length)
          : 0;

      return {
        classArmId: query.classArmId,
        termId: query.termId,
        summary,
        armSummary: { totalDaysOperated: operatingDays.size, armAttendanceRate },
      };
    });
  }

  // -------------------------------------------------------------------------
  // Gate — daily attendance is form-teacher + owner/admin only (Q3/Q8). A
  // SUBJECT teacher of this same arm can SEE the arm but may NOT touch daily
  // attendance → 403. A teacher for whom the arm is wholly out of scope (incl.
  // the form teacher of a DIFFERENT arm) gets 404 — the arm is invisible to
  // them, same as cross-tenant. Subject-period attendance is slice 8.
  // -------------------------------------------------------------------------
  private async assertCanAccessArmAttendance(
    db: TenantDb,
    authCtx: AuthContext,
    classArmId: string,
  ): Promise<void> {
    const roleKeys = await this.resolveRoleKeys(db, authCtx.userId);
    if (roleKeys.includes("owner") || roleKeys.includes("admin")) return;

    const scope = await getTeacherScope(db, authCtx.userId);
    if (scope.formTeacherArmIds.includes(classArmId)) return; // form teacher ✓
    if (scope.classArms.some((a) => a.id === classArmId)) {
      // In scope (teaches a subject here) but not the form teacher.
      throw new ForbiddenError("Only the form teacher can manage daily attendance for this class.");
    }
    throw new NotFoundError("Class arm not found.");
  }

  // Roster for a register: students ENROLLED in (arm, term) who had joined by
  // `date`. enrolledAt is a timestamp; `< nextMidnight` includes same-day joins
  // and excludes anyone enrolled after the date (Q5 mid-term-join exclusion).
  private async loadRoster(
    db: TenantDb,
    classArmId: string,
    termId: string,
    dateObj: Date,
  ): Promise<Array<{ id: string; firstName: string; middleName: string | null; lastName: string; admissionNumber: string }>> {
    const nextDay = new Date(dateObj.getTime() + MS_PER_DAY);
    const enrollments = await db.enrollment.findMany({
      where: { classArmId, termId, status: "ENROLLED", enrolledAt: { lt: nextDay } },
      select: { studentId: true },
    });
    const studentIds = enrollments.map((e) => e.studentId);
    return db.student.findMany({
      where: { id: { in: studentIds } },
      select: STUDENT_NAME_SELECT,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
  }

  // A date may only be marked/read if it falls inside an academic term and is
  // not in the future. Both throw 400 (ValidationError).
  private async resolveTermForDate(db: TenantDb, dateObj: Date): Promise<{ id: string }> {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (dateObj.getTime() > today.getTime()) {
      throw new ValidationError("Cannot record attendance for a future date.");
    }
    const term = await db.term.findFirst({
      where: { startDate: { lte: dateObj }, endDate: { gte: dateObj } },
      select: { id: true },
    });
    if (!term) throw new ValidationError("Date is not within any academic term.");
    return term;
  }

  private parseIsoDate(date: string): Date {
    // YYYY-MM-DD (already regex-validated) → UTC midnight, matching how Prisma
    // reads a @db.Date column back. Keeps day comparisons timezone-free.
    return new Date(`${date}T00:00:00.000Z`);
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

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

const STUDENT_NAME_SELECT = {
  id: true,
  firstName: true,
  middleName: true,
  lastName: true,
  admissionNumber: true,
} as const;

function fullName(s: { firstName: string; middleName: string | null; lastName: string }): string {
  return [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
}

function rateHundredths(attended: number, days: number): number {
  if (days <= 0) return 0;
  return Math.round((attended * 10_000) / days);
}
