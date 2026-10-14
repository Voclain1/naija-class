import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  addDays,
  lagosTodayIso,
  RANKING_SIZE,
  TEACHER_TREND_TERMS,
  type AcademicReportDto,
  type AttendanceReportDto,
  type ChronicAbsenceRowDto,
  type ClassRankingDto,
  type EnrolmentMoverDto,
  type EnrolmentReportDto,
  type TeacherTrendReportDto,
  type TeacherTrendRowDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { fullName, rateHundredths } from "../attendance/shared/attendance-shared.util.js";
import { CompletenessService, REPORTS_TRANSACTION_TIMEOUT_MS, type TermRow } from "./completeness.service.js";

// Phase 9 / CP1.2 — the Academic, Attendance, Enrolment and Teachers tabs
// (docs/modules/phase-9.md §8.3). Owner/admin only, at both gates (CP1-D6).
//
// THE RULES THAT MAKE THESE NUMBERS TRUSTWORTHY, each in one place:
//   * results     → RELEASED report cards only (CP1-D4). A class average is the
//                   mean of its released cards' overallAverage; a subject cell
//                   is the mean of totalScore for students whose card is released.
//   * attendance  → (present + late) ÷ records marked, the rate every other
//                   screen uses (rateHundredths). EXCUSED counts as marked, not
//                   attended (attendance Q7 policy i).
//   * on roll     → an enrolment row for the term whose status is not WITHDRAWN
//                   or TRANSFERRED: who was, or still is, in the class that term.
//   * missing registers and the teacher trend come from CompletenessService,
//     so they can never disagree with the Recording report.
// A fixed number of grouped queries per request, never one per class, in one
// withTenant transaction (the teacher trend uses one per term).

type Db = Parameters<Parameters<typeof withTenant>[1]>[0];

interface RequestContext {
  ipAddress: string | null;
}

const MANAGER_ROLES = ["owner", "admin"] as const;
const AUDIT_TEACHER_ACTIVITY_VIEW = "reports.teacher-activity.view";

interface NameRow {
  first_name: string;
  middle_name: string | null;
  last_name: string;
}
const nameOf = (r: NameRow) => fullName({ firstName: r.first_name, middleName: r.middle_name, lastName: r.last_name });

/** Monday (YYYY-MM-DD) of the ISO week holding `iso`. */
export function mondayOf(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((day + 6) % 7));
}

/** Every Monday from the week of `from` to the week of `to`, oldest first. */
export function weekStarts(from: string, to: string): string[] {
  if (to < from) return [];
  const out: string[] = [];
  for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) out.push(w);
  return out;
}

/** Top `size` by average, and a bottom list that never repeats a top student. */
export function splitRanking<T>(ranked: T[], size: number): { top: T[]; bottom: T[] } {
  const top = ranked.slice(0, size);
  const bottomCount = Math.max(0, Math.min(size, ranked.length - size));
  const bottom = ranked.slice(ranked.length - bottomCount).reverse();
  return { top, bottom };
}

const LEAVER_REASON: Record<string, string> = {
  WITHDRAWN: "Withdrawn",
  TRANSFERRED: "Transferred",
  GRADUATED: "Graduated",
};

@Injectable()
export class AnalyticsService {
  constructor(private readonly completeness: CompletenessService) {}

  /** The report's "as of" day (Lagos). A property so specs can pin it. */
  todayFn: () => string = lagosTodayIso;

  // ===========================================================================
  // GET /reports/academic
  // ===========================================================================
  async getAcademic(authCtx: AuthContext, termId: string | undefined): Promise<AcademicReportDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGER_ROLES);
    const schoolId = authCtx.schoolId;

    return withTenant(schoolId, async (db) => {
      const term = await this.completeness.termForReport(db, schoolId, termId);
      if (!term) return { term: null, previousTerm: null, classes: [], subjects: [], cells: [], rankings: [] };
      const [prev] = await this.completeness.previousTerms(db, schoolId, term, 1);

      type ClassAverageRow = { class_arm_id: string; label: string; level_name: string; n: number; avg: number };
      const classAverages = (forTermId: string): Promise<ClassAverageRow[]> =>
        db.$queryRawUnsafe<ClassAverageRow[]>(
          `SELECT rc.class_arm_id, a.name AS label, l.name AS level_name,
                  count(*)::int AS n, round(avg(rc.overall_average))::int AS avg
           FROM report_cards rc
           JOIN class_arms a ON a.id = rc.class_arm_id AND a.school_id = $1
           JOIN class_levels l ON l.id = a.class_level_id AND l.school_id = $1
           WHERE rc.school_id = $1 AND rc.term_id = $2
             AND rc.status = 'RELEASED' AND rc.overall_average IS NOT NULL
           GROUP BY rc.class_arm_id, a.name, l.name, l.order_index
           ORDER BY l.order_index, a.name`,
          schoolId,
          forTermId,
        );

      const [current, previous, cells, ranked] = await Promise.all([
        classAverages(term.id),
        prev ? classAverages(prev.id) : Promise.resolve<ClassAverageRow[]>([]),
        // Subject cells: only students whose card for the term is RELEASED.
        // avg(total_score) is a whole-number mark, ×100 into hundredths.
        db.$queryRawUnsafe<Array<{ class_arm_id: string; subject_id: string; subject_name: string; n: number; avg: number }>>(
          `SELECT asm.class_arm_id, asm.subject_id, s.name AS subject_name,
                  count(*)::int AS n, round(avg(asm.total_score) * 100)::int AS avg
           FROM assessments asm
           JOIN report_cards rc
             ON rc.student_id = asm.student_id AND rc.term_id = asm.term_id
            AND rc.school_id = $1 AND rc.status = 'RELEASED'
           JOIN subjects s ON s.id = asm.subject_id AND s.school_id = $1
           WHERE asm.school_id = $1 AND asm.term_id = $2
           GROUP BY asm.class_arm_id, asm.subject_id, s.name`,
          schoolId,
          term.id,
        ),
        // Top and bottom: one ordering, so a tie can never put a student in
        // both lists or leave one out of both.
        db.$queryRawUnsafe<
          Array<NameRow & { class_arm_id: string; student_id: string; admission_number: string; avg: number; rn: number }>
        >(
          `SELECT rc.class_arm_id, st.id AS student_id, st.first_name, st.middle_name, st.last_name,
                  st.admission_number, rc.overall_average AS avg,
                  row_number() OVER (
                    PARTITION BY rc.class_arm_id
                    ORDER BY rc.overall_average DESC, st.last_name, st.first_name, st.id
                  )::int AS rn
           FROM report_cards rc
           JOIN students st ON st.id = rc.student_id AND st.school_id = $1
           WHERE rc.school_id = $1 AND rc.term_id = $2
             AND rc.status = 'RELEASED' AND rc.overall_average IS NOT NULL
           ORDER BY rc.class_arm_id, rn`,
          schoolId,
          term.id,
        ),
      ]);

      const prevByArm = new Map<string, number>(previous.map((p) => [p.class_arm_id, p.avg]));
      const classes = current.map((c) => {
        const before = prevByArm.get(c.class_arm_id) ?? null;
        return {
          groupId: c.class_arm_id,
          label: c.label,
          classLevelName: c.level_name,
          releasedCount: c.n,
          averageHundredths: c.avg,
          previousAverageHundredths: before,
          changeHundredths: before === null ? null : c.avg - before,
        };
      });

      const subjects = new Map<string, string>();
      for (const c of cells) subjects.set(c.subject_id, c.subject_name);

      const byArm = new Map<string, typeof ranked>();
      for (const r of ranked) byArm.set(r.class_arm_id, [...(byArm.get(r.class_arm_id) ?? []), r]);
      const rankings: ClassRankingDto[] = classes.map((c) => {
        const list = (byArm.get(c.groupId) ?? []).map((r) => ({
          studentId: r.student_id,
          name: nameOf(r),
          admissionNumber: r.admission_number,
          averageHundredths: r.avg,
        }));
        return { groupId: c.groupId, label: c.label, ...splitRanking(list, RANKING_SIZE) };
      });

      return {
        term: this.completeness.termDto(term),
        previousTerm: prev ? this.completeness.termDto(prev) : null,
        classes,
        subjects: [...subjects].map(([subjectId, subjectName]) => ({ subjectId, subjectName })).sort((a, b) => a.subjectName.localeCompare(b.subjectName)),
        cells: cells.map((c) => ({ groupId: c.class_arm_id, subjectId: c.subject_id, averageHundredths: c.avg, studentCount: c.n })),
        rankings,
      };
    }, { timeoutMs: REPORTS_TRANSACTION_TIMEOUT_MS, label: "reports.getAcademic" });
  }

  // ===========================================================================
  // GET /reports/attendance
  // ===========================================================================
  async getAttendance(authCtx: AuthContext, termId: string | undefined): Promise<AttendanceReportDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGER_ROLES);
    const schoolId = authCtx.schoolId;
    const today = this.todayFn();

    return withTenant(schoolId, async (db) => {
      const school = await db.school.findUnique({ where: { id: schoolId }, select: { chronicAbsenceThreshold: true } });
      const thresholdPercent = school?.chronicAbsenceThreshold ?? 90;
      const term = await this.completeness.termForReport(db, schoolId, termId);
      if (!term) return { term: null, thresholdPercent, weeks: [], classes: [], chronicAbsence: [], missingRegisters: [] };

      const countedTo = today < term.end_date ? today : term.end_date;
      const weeks = weekStarts(term.start_date, countedTo);

      const [arms, weekly, students, missingRegisters] = await Promise.all([
        this.armsOnRoll(db, schoolId, term.id),
        db.$queryRawUnsafe<Array<{ class_arm_id: string; wk: string; marked: number; attended: number }>>(
          `SELECT ar.class_arm_id, date_trunc('week', ar.date)::date::text AS wk,
                  count(*)::int AS marked,
                  count(*) FILTER (WHERE ar.status IN ('PRESENT', 'LATE'))::int AS attended
           FROM attendance_records ar
           WHERE ar.school_id = $1 AND ar.term_id = $2 AND ar.date <= $3::date
           GROUP BY ar.class_arm_id, wk`,
          schoolId,
          term.id,
          countedTo,
        ),
        db.$queryRawUnsafe<
          Array<NameRow & { student_id: string; admission_number: string; class_label: string; marked: number; absent: number; attended: number }>
        >(
          `SELECT st.id AS student_id, st.first_name, st.middle_name, st.last_name, st.admission_number,
                  a.name AS class_label,
                  count(*)::int AS marked,
                  count(*) FILTER (WHERE ar.status = 'ABSENT')::int AS absent,
                  count(*) FILTER (WHERE ar.status IN ('PRESENT', 'LATE'))::int AS attended
           FROM attendance_records ar
           JOIN enrollments e
             ON e.student_id = ar.student_id AND e.term_id = ar.term_id
            AND e.school_id = $1 AND e.status = 'ENROLLED'
           JOIN students st ON st.id = ar.student_id AND st.school_id = $1
           JOIN class_arms a ON a.id = e.class_arm_id AND a.school_id = $1
           WHERE ar.school_id = $1 AND ar.term_id = $2 AND ar.date <= $3::date
           GROUP BY st.id, st.first_name, st.middle_name, st.last_name, st.admission_number, a.name`,
          schoolId,
          term.id,
          countedTo,
        ),
        this.completeness.missingRegisterRows(db, schoolId, term, today),
      ]);

      const cell = new Map(weekly.map((w) => [`${w.class_arm_id}|${w.wk}`, w]));
      const classes = arms.map((a) => {
        let marked = 0;
        let attended = 0;
        const cells = weeks.map((wk) => {
          const w = cell.get(`${a.id}|${wk}`);
          marked += w?.marked ?? 0;
          attended += w?.attended ?? 0;
          return {
            weekStart: wk,
            rateHundredths: w && w.marked > 0 ? rateHundredths(w.attended, w.marked) : null,
            recordsMarked: w?.marked ?? 0,
          };
        });
        return {
          groupId: a.id,
          label: a.name,
          classLevelName: a.level_name,
          weeks: cells,
          termRateHundredths: marked > 0 ? rateHundredths(attended, marked) : null,
        };
      });

      // Below the line, not at it: a school that sets 90% lists 89.99%, not 90.00%.
      const line = thresholdPercent * 100;
      const chronicAbsence: ChronicAbsenceRowDto[] = students
        .map((s) => ({
          studentId: s.student_id,
          name: nameOf(s),
          admissionNumber: s.admission_number,
          classLabel: s.class_label,
          daysMarked: s.marked,
          daysAbsent: s.absent,
          rateHundredths: rateHundredths(s.attended, s.marked),
        }))
        .filter((s) => s.daysMarked > 0 && s.rateHundredths < line)
        .sort((a, b) => a.rateHundredths - b.rateHundredths || a.name.localeCompare(b.name));

      return { term: this.completeness.termDto(term), thresholdPercent, weeks, classes, chronicAbsence, missingRegisters };
    }, { timeoutMs: REPORTS_TRANSACTION_TIMEOUT_MS, label: "reports.getAttendance" });
  }

  // ===========================================================================
  // GET /reports/enrolment
  // ===========================================================================
  async getEnrolment(authCtx: AuthContext, termId: string | undefined): Promise<EnrolmentReportDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGER_ROLES);
    const schoolId = authCtx.schoolId;

    return withTenant(schoolId, async (db) => {
      const term = await this.completeness.termForReport(db, schoolId, termId);
      if (!term) {
        return { term: null, previousTerm: null, levels: [], totals: { thisTerm: 0, previousTerm: null }, joiners: [], leavers: [] };
      }
      const [prev] = await this.completeness.previousTerms(db, schoolId, term, 1);
      const prevId = prev?.id ?? null;

      const ON_ROLL = `status NOT IN ('WITHDRAWN', 'TRANSFERRED')`;
      const [levels, joiners, leavers] = await Promise.all([
        db.$queryRawUnsafe<Array<{ id: string; name: string; this_term: number; prev_term: number }>>(
          `SELECT l.id, l.name,
                  count(*) FILTER (WHERE e.term_id = $2)::int AS this_term,
                  count(*) FILTER (WHERE e.term_id = $3)::int AS prev_term
           FROM enrollments e
           JOIN class_arms a ON a.id = e.class_arm_id AND a.school_id = $1
           JOIN class_levels l ON l.id = a.class_level_id AND l.school_id = $1
           WHERE e.school_id = $1 AND e.term_id IN ($2, $3) AND e.${ON_ROLL}
           GROUP BY l.id, l.name, l.order_index
           ORDER BY l.order_index, l.name`,
          schoolId,
          term.id,
          prevId,
        ),
        prevId
          ? db.$queryRawUnsafe<Array<NameRow & { student_id: string; admission_number: string; class_label: string }>>(
              `SELECT st.id AS student_id, st.first_name, st.middle_name, st.last_name, st.admission_number, a.name AS class_label
               FROM enrollments e
               JOIN students st ON st.id = e.student_id AND st.school_id = $1
               JOIN class_arms a ON a.id = e.class_arm_id AND a.school_id = $1
               WHERE e.school_id = $1 AND e.term_id = $2 AND e.${ON_ROLL}
                 AND NOT EXISTS (
                   SELECT 1 FROM enrollments p
                   WHERE p.school_id = $1 AND p.term_id = $3 AND p.student_id = e.student_id AND p.${ON_ROLL}
                 )
               ORDER BY a.name, st.last_name, st.first_name`,
              schoolId,
              term.id,
              prevId,
            )
          : Promise.resolve([]),
        prevId
          ? db.$queryRawUnsafe<
              Array<NameRow & { student_id: string; admission_number: string; class_label: string; now_status: string | null; student_status: string }>
            >(
              `SELECT st.id AS student_id, st.first_name, st.middle_name, st.last_name, st.admission_number,
                      a.name AS class_label, n.status::text AS now_status, st.status::text AS student_status
               FROM enrollments p
               JOIN students st ON st.id = p.student_id AND st.school_id = $1
               JOIN class_arms a ON a.id = p.class_arm_id AND a.school_id = $1
               LEFT JOIN enrollments n ON n.school_id = $1 AND n.term_id = $2 AND n.student_id = p.student_id
               WHERE p.school_id = $1 AND p.term_id = $3 AND p.${ON_ROLL}
                 AND (n.id IS NULL OR n.status IN ('WITHDRAWN', 'TRANSFERRED'))
               ORDER BY a.name, st.last_name, st.first_name`,
              schoolId,
              term.id,
              prevId,
            )
          : Promise.resolve([]),
      ]);

      const mover = (r: NameRow & { student_id: string; admission_number: string; class_label: string }, reason: string): EnrolmentMoverDto => ({
        studentId: r.student_id,
        name: nameOf(r),
        admissionNumber: r.admission_number,
        classLabel: r.class_label,
        reason,
      });

      return {
        term: this.completeness.termDto(term),
        previousTerm: prev ? this.completeness.termDto(prev) : null,
        levels: levels.map((l) => ({ groupId: l.id, label: l.name, thisTerm: l.this_term, previousTerm: prevId ? l.prev_term : null })),
        totals: {
          thisTerm: levels.reduce((n, l) => n + l.this_term, 0),
          previousTerm: prevId ? levels.reduce((n, l) => n + l.prev_term, 0) : null,
        },
        joiners: joiners.map((j) => mover(j, "New this term")),
        leavers: leavers.map((l) =>
          mover(
            l,
            LEAVER_REASON[l.now_status ?? ""] ?? LEAVER_REASON[l.student_status] ?? "Not enrolled this term",
          ),
        ),
      };
    }, { timeoutMs: REPORTS_TRANSACTION_TIMEOUT_MS, label: "reports.getEnrolment" });
  }

  // ===========================================================================
  // GET /reports/teacher-trend — recording only (CP1-D8). Audited, as the
  // teacher-activity view is (Phase 8 D23): it names colleagues' work.
  // ===========================================================================
  async getTeacherTrend(authCtx: AuthContext, termId: string | undefined, reqCtx: RequestContext): Promise<TeacherTrendReportDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGER_ROLES);
    const schoolId = authCtx.schoolId;
    const today = this.todayFn();

    const terms = await withTenant(schoolId, async (db) => {
      const term = await this.completeness.termForReport(db, schoolId, termId);
      await db.auditLog.create({
        data: {
          schoolId,
          userId: authCtx.userId,
          action: AUDIT_TEACHER_ACTIVITY_VIEW,
          entityType: "term",
          entityId: term?.id ?? null,
          ipAddress: reqCtx.ipAddress,
          metadata: { termId: term?.id ?? null, requestedTermId: termId ?? null, view: "trend" },
        },
      });
      if (!term) return [];
      const earlier = await this.completeness.previousTerms(db, schoolId, term, TEACHER_TREND_TERMS - 1);
      return [...earlier.reverse(), term];
    });

    // One transaction per term: each loads a full term context (~12 queries),
    // and three in one transaction would crowd the reports timeout.
    const perTerm: Array<{ term: TermRow; rows: Awaited<ReturnType<CompletenessService["teacherRowsForTerm"]>> }> = [];
    for (const t of terms) {
      const rows = await withTenant(schoolId, (db) => this.completeness.teacherRowsForTerm(db, schoolId, t, today), {
        timeoutMs: REPORTS_TRANSACTION_TIMEOUT_MS,
        label: "reports.getTeacherTrend",
      });
      perTerm.push({ term: t, rows });
    }

    // Everyone who holds the teacher role now, named as they are now.
    const latest = perTerm[perTerm.length - 1]?.rows ?? [];
    const rows: TeacherTrendRowDto[] = latest.map((teacher) => ({
      userId: teacher.userId,
      name: teacher.name,
      terms: perTerm.map(({ term, rows: termRows }) => {
        const r = termRows.find((x) => x.userId === teacher.userId);
        if (!r || (r.formArms.length === 0 && r.assignmentCount === 0)) return null;
        return {
          termId: term.id,
          formRegistersTaken: r.formArmRegistersTaken,
          formRegistersExpected: r.formArmRegistersExpected,
          scoresEntered: r.assignedSlotsEntered,
          scoresExpected: r.assignedSlotsExpected,
        };
      }),
    }));

    return { terms: perTerm.map(({ term }) => this.completeness.termDto(term)), rows };
  }

  private armsOnRoll(db: Db, schoolId: string, termId: string) {
    return db.$queryRawUnsafe<Array<{ id: string; name: string; level_name: string }>>(
      `SELECT a.id, a.name, l.name AS level_name
       FROM enrollments e
       JOIN class_arms a ON a.id = e.class_arm_id AND a.school_id = $1
       JOIN class_levels l ON l.id = a.class_level_id AND l.school_id = $1
       WHERE e.school_id = $1 AND e.term_id = $2 AND e.status = 'ENROLLED'
       GROUP BY a.id, a.name, l.name, l.order_index
       ORDER BY l.order_index, a.name`,
      schoolId,
      termId,
    );
  }
}
