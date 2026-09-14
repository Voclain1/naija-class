import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  lagosTodayIso,
  NotFoundError,
  REPORT_CARD_STATUS_KEYS,
  type AttendanceArmRowDto,
  type CompletenessReportDto,
  type CompletenessTermDto,
  type ReportCardPipelineRowDto,
  type ScoreEntryRowDto,
  type TeacherActivityReportDto,
  type TeacherActivityRowDto,
  type UnassignedScoresRowDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { CalendarService } from "../calendar/calendar.service.js";
import { computeSchoolDays, type SchoolDaysResult } from "./school-days.js";
import { computeTermHealth } from "./term-health.js";

// Phase 8 / CP2 — Recording Completeness (docs/modules/phase-8.md §16).
//
// WHAT THIS IS: counts of records that exist against records that were owed.
// WHAT THIS IS NOT: any statement about what the records say. No query here
// selects a score value, a grade, an average, a position or a student name.
//
// THE EXPECTED DEFINITIONS are the product (§16.10 — "one false 'missed
// register' costs the report its credibility"), so each lives in one place:
//   * school days        → school-days.ts (D33–D34, Q31)
//   * registers expected → arms with ≥1 ENROLLED student this term × school days (D33)
//   * a register taken   → ≥1 AttendanceRecord for that arm on a SCHOOL DAY (D33)
//   * score slots        → effective assignment (arm × subject) × enrolled × components (D35)
//
// QUERY BUDGET (D38): a fixed number of grouped queries per request, never one
// per arm — completeness: 9 here + 3 inside CalendarService.buildCalendar = 12.
// All inside ONE withTenant transaction (RLS applies; school_id is also stated
// in every WHERE).

type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

interface RequestContext {
  ipAddress: string | null;
}

const MANAGER_ROLES = ["owner", "admin"] as const;

// Overrides Prisma's 5000 ms interactive-transaction default — the same value,
// for the same reason, as DASHBOARD_TRANSACTION_TIMEOUT_MS
// (dashboard.service.ts), whose header explains the arithmetic: a transaction
// is ONE connection running one statement at a time, so ~12 statements across
// the Fly-Johannesburg → Neon-Frankfurt hop leave ~400 ms each inside 5 s, with
// Neon's autosuspend wake on top.
//
// NOT theoretical: CP2's live production verification on 2026-09-14 logged
// "retrying after connection-level error (P2028) after 5024ms — body ran long"
// on this report (docs/modules/phase-8.md §16.12). withTenant's single retry
// rescued it that time; an admin on a slow morning would eventually get a 500.
//
// Safe for the same reason the dashboard's is: every report read runs on this
// ONE connection with no nested withTenant, so a longer hold waits on nothing
// and cannot deadlock. reports-transaction.spec.ts pins both properties.
export const REPORTS_TRANSACTION_TIMEOUT_MS = 15_000;

const AUDIT_TEACHER_ACTIVITY_VIEW = "reports.teacher-activity.view";

interface TermRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  academic_year_id: string;
  year_label: string;
  /** schools.school_week_days (§17 D34). */
  school_week_days: number[];
}

interface ArmRow {
  id: string;
  name: string;
  level_name: string;
  class_teacher_id: string | null;
  enrolled: number;
}

interface AssignmentRow {
  class_arm_id: string;
  subject_id: string;
  subject_name: string;
  teacher_id: string;
}

interface ScoreCountRow {
  entered_by: string;
  class_arm_id: string;
  subject_id: string;
  subject_name: string;
  n: number;
  last_entered: Date;
}

interface MarkRow {
  class_arm_id: string;
  d: string;
  marked_by: string;
  last_marked: Date;
}

/** Shared term + school-days + arms + registers + assignments + scores context for both reports. */
interface TermContext {
  term: CompletenessTermDto;
  academicYearId: string;
  days: SchoolDaysResult;
  arms: ArmRow[];
  componentCount: number;
  marks: MarkRow[];
  assignments: AssignmentRow[];
  scoreCounts: ScoreCountRow[];
}

const pairKey = (armId: string, subjectId: string) => `${armId}|${subjectId}`;
const emptyByStatus = () =>
  Object.fromEntries(REPORT_CARD_STATUS_KEYS.map((k) => [k, 0])) as ReportCardPipelineRowDto["byStatus"];

@Injectable()
export class CompletenessService {
  constructor(private readonly calendar: CalendarService) {}

  /**
   * The report's "as of" day (Lagos). A plain property, not a constructor
   * argument, so Nest DI is unaffected and specs can pin it: every expected
   * figure depends on today, and a test that reads the real clock would assert
   * a different number each day.
   */
  todayFn: () => string = lagosTodayIso;

  // ===========================================================================
  // GET /reports/completeness
  // ===========================================================================
  async getCompleteness(authCtx: AuthContext, termId: string | undefined): Promise<CompletenessReportDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGER_ROLES);
    const today = this.todayFn();

    return withTenant(authCtx.schoolId, async (db) => {
      const termRow = await this.loadTerm(db, authCtx.schoolId, termId);
      const health = await computeTermHealth(db, authCtx.schoolId, termRow?.id ?? null, today);
      if (!termRow) {
        return { term: null, health, schoolDays: null, attendance: null, scores: null, reportCards: null };
      }

      const ctx = await this.loadTermContext(db, authCtx.schoolId, termRow, today);

      const [assessmentRows, cardRows] = await Promise.all([
        db.$queryRawUnsafe<Array<{ class_arm_id: string; subject_id: string; with_scores: number; signed_off: number }>>(
          `SELECT class_arm_id, subject_id, count(*)::int AS with_scores,
                  count(*) FILTER (WHERE subject_signed_off_at IS NOT NULL)::int AS signed_off
           FROM assessments
           WHERE school_id = $1 AND term_id = $2
           GROUP BY class_arm_id, subject_id`,
          authCtx.schoolId,
          termRow.id,
        ),
        // Attributed to the student's ENROLLMENT arm this term; a LEFT JOIN so
        // enrolled students with no card are counted (status IS NULL group).
        db.$queryRawUnsafe<Array<{ class_arm_id: string; status: string | null; n: number }>>(
          `SELECT e.class_arm_id, rc.status::text AS status, count(*)::int AS n
           FROM enrollments e
           LEFT JOIN report_cards rc
             ON rc.student_id = e.student_id AND rc.term_id = e.term_id AND rc.school_id = $1
           WHERE e.school_id = $1 AND e.term_id = $2 AND e.status = 'ENROLLED'
           GROUP BY e.class_arm_id, rc.status`,
          authCtx.schoolId,
          termRow.id,
        ),
      ]);

      return {
        term: ctx.term,
        health,
        schoolDays: ctx.days.dto,
        attendance: this.buildAttendance(ctx),
        scores: this.buildScores(ctx, assessmentRows),
        reportCards: this.buildReportCards(ctx, cardRows),
      };
    }, { timeoutMs: REPORTS_TRANSACTION_TIMEOUT_MS, label: "reports.getCompleteness" });
  }

  // ===========================================================================
  // GET /reports/teacher-activity — recording activity only (D37). Audited.
  // ===========================================================================
  async getTeacherActivity(
    authCtx: AuthContext,
    termId: string | undefined,
    reqCtx: RequestContext,
  ): Promise<TeacherActivityReportDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGER_ROLES);
    const today = this.todayFn();

    return withTenant(authCtx.schoolId, async (db) => {
      const termRow = await this.loadTerm(db, authCtx.schoolId, termId);

      // §3.4 D23: EVERY read is audited — including one that finds no term, since
      // the request to view colleagues' recording activity was still made.
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT_TEACHER_ACTIVITY_VIEW,
          entityType: "term",
          entityId: termRow?.id ?? null,
          ipAddress: reqCtx.ipAddress,
          metadata: { termId: termRow?.id ?? null, requestedTermId: termId ?? null },
        },
      });

      if (!termRow) return { term: null, schoolDays: null, rows: [] };

      const ctx = await this.loadTermContext(db, authCtx.schoolId, termRow, today);
      const teachers = await db.$queryRawUnsafe<Array<{ id: string; first_name: string; last_name: string }>>(
        `SELECT u.id, u.first_name, u.last_name
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE u.school_id = $1 AND u.is_active AND r.key = 'teacher'
         GROUP BY u.id, u.first_name, u.last_name
         ORDER BY u.last_name, u.first_name`,
        authCtx.schoolId,
      );

      return { term: ctx.term, schoolDays: ctx.days.dto, rows: this.buildTeacherRows(ctx, teachers) };
    }, { timeoutMs: REPORTS_TRANSACTION_TIMEOUT_MS, label: "reports.getTeacherActivity" });
  }

  // ===========================================================================
  // Loading
  // ===========================================================================

  private async loadTerm(db: TenantDb, schoolId: string, termId: string | undefined): Promise<TermRow | null> {
    const [row] = await db.$queryRawUnsafe<TermRow[]>(
      `SELECT t.id, t.name, t.start_date::text AS start_date, t.end_date::text AS end_date, t.is_current,
              t.academic_year_id, ay.label AS year_label,
              (SELECT s.school_week_days::int[] FROM schools s WHERE s.id = $1) AS school_week_days
       FROM terms t JOIN academic_years ay ON ay.id = t.academic_year_id AND ay.school_id = $1
       WHERE t.school_id = $1
         AND t.id = COALESCE($2::text, (SELECT id FROM terms WHERE school_id = $1 AND is_current LIMIT 1))`,
      schoolId,
      termId ?? null,
    );
    // A termId that names no term IN THIS SCHOOL is a 404, exactly like one that
    // does not exist (CLAUDE.md — re-validate tenancy on every id). No termId and
    // no current term is not an error: the report says so via NO_CURRENT_TERM.
    if (!row && termId) throw new NotFoundError("Term not found.");
    return row ?? null;
  }

  private async loadTermContext(db: TenantDb, schoolId: string, t: TermRow, today: string): Promise<TermContext> {
    const countedTo = today < t.end_date ? today : t.end_date;
    const started = countedTo >= t.start_date;

    const [calendar, arms, components, marks, assignments, scoreCounts] = await Promise.all([
      // Q31: holidays via CP1's single reader, which already omits national
      // events this school hid. Not needed at all before the term starts.
      started
        ? this.calendar.buildCalendar(db, schoolId, { from: t.start_date, to: countedTo })
        : Promise.resolve([]),
      db.$queryRawUnsafe<ArmRow[]>(
        `SELECT a.id, a.name, l.name AS level_name, a.class_teacher_id, count(*)::int AS enrolled
         FROM enrollments e
         JOIN class_arms a ON a.id = e.class_arm_id AND a.school_id = $1
         JOIN class_levels l ON l.id = a.class_level_id AND l.school_id = $1
         WHERE e.school_id = $1 AND e.term_id = $2 AND e.status = 'ENROLLED'
         GROUP BY a.id, a.name, l.name, l.order_index, a.class_teacher_id
         ORDER BY l.order_index, a.name`,
        schoolId,
        t.id,
      ),
      db.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM grading_components WHERE school_id = $1`,
        schoolId,
      ),
      // One row per (arm, date, marker). Bounded to [term start, countedTo]:
      // a register dated in the future cannot be "taken" yet.
      started
        ? db.$queryRawUnsafe<MarkRow[]>(
            `SELECT class_arm_id, date::text AS d, marked_by, max(marked_at) AS last_marked
             FROM attendance_records
             WHERE school_id = $1 AND term_id = $2 AND date BETWEEN $3::date AND $4::date
             GROUP BY class_arm_id, date, marked_by`,
            schoolId,
            t.id,
            t.start_date,
            countedTo,
          )
        : Promise.resolve([] as MarkRow[]),
      // D35 — an assignment is effective in this term when it names the term, or
      // names no term and belongs to the term's academic year.
      db.$queryRawUnsafe<AssignmentRow[]>(
        `SELECT DISTINCT ta.class_arm_id, ta.subject_id, s.name AS subject_name, ta.teacher_id
         FROM teacher_assignments ta
         JOIN subjects s ON s.id = ta.subject_id AND s.school_id = $1
         WHERE ta.school_id = $1 AND ta.is_active
           AND (ta.term_id = $2 OR (ta.term_id IS NULL AND ta.academic_year_id = $3))`,
        schoolId,
        t.id,
        t.academic_year_id,
      ),
      // Scores entered this term, attributed to the student's ENROLLED arm this
      // term, split by who keyed them (the teacher view needs the split; the
      // school view sums it).
      db.$queryRawUnsafe<ScoreCountRow[]>(
        `SELECT sc.entered_by, e.class_arm_id, sc.subject_id, s.name AS subject_name,
                count(*)::int AS n, max(sc.entered_at) AS last_entered
         FROM assessment_scores sc
         JOIN enrollments e
           ON e.student_id = sc.student_id AND e.term_id = sc.term_id
          AND e.school_id = $1 AND e.status = 'ENROLLED'
         JOIN subjects s ON s.id = sc.subject_id AND s.school_id = $1
         WHERE sc.school_id = $1 AND sc.term_id = $2
         GROUP BY sc.entered_by, e.class_arm_id, sc.subject_id, s.name`,
        schoolId,
        t.id,
      ),
    ]);

    return {
      term: {
        id: t.id,
        name: t.name,
        academicYearLabel: t.year_label,
        startDate: t.start_date,
        endDate: t.end_date,
        isCurrent: t.is_current,
      },
      academicYearId: t.academic_year_id,
      days: computeSchoolDays(t.start_date, t.end_date, today, calendar, t.school_week_days),
      arms,
      componentCount: components[0]?.n ?? 0,
      marks,
      assignments,
      scoreCounts,
    };
  }

  // ===========================================================================
  // Building — pure over the loaded context
  // ===========================================================================

  /** Distinct marked dates per arm, split into school days and non-school days. */
  private registerDates(ctx: TermContext): Map<string, { onSchoolDays: Set<string>; offSchoolDays: Set<string> }> {
    const out = new Map<string, { onSchoolDays: Set<string>; offSchoolDays: Set<string> }>();
    for (const m of ctx.marks) {
      const entry = out.get(m.class_arm_id) ?? { onSchoolDays: new Set(), offSchoolDays: new Set() };
      (ctx.days.schoolDaySet.has(m.d) ? entry.onSchoolDays : entry.offSchoolDays).add(m.d);
      out.set(m.class_arm_id, entry);
    }
    return out;
  }

  private buildAttendance(ctx: TermContext): NonNullable<CompletenessReportDto["attendance"]> {
    const byArm = this.registerDates(ctx);
    const expectedPerArm = ctx.days.dto.schoolDayCount;
    const rows: AttendanceArmRowDto[] = ctx.arms.map((a) => {
      const dates = byArm.get(a.id);
      const all = dates ? [...dates.onSchoolDays, ...dates.offSchoolDays].sort() : [];
      return {
        groupId: a.id,
        label: a.name,
        classLevelName: a.level_name,
        enrolledCount: a.enrolled,
        registersExpected: expectedPerArm,
        registersTaken: dates?.onSchoolDays.size ?? 0,
        registersOnNonSchoolDays: dates?.offSchoolDays.size ?? 0,
        lastRegisterDate: all.length > 0 ? all[all.length - 1] : null,
      };
    });
    return {
      rows,
      totals: {
        registersExpected: rows.reduce((s, r) => s + r.registersExpected, 0),
        registersTaken: rows.reduce((s, r) => s + r.registersTaken, 0),
        registersOnNonSchoolDays: rows.reduce((s, r) => s + r.registersOnNonSchoolDays, 0),
      },
    };
  }

  private buildScores(
    ctx: TermContext,
    assessmentRows: Array<{ class_arm_id: string; subject_id: string; with_scores: number; signed_off: number }>,
  ): NonNullable<CompletenessReportDto["scores"]> {
    const armById = new Map(ctx.arms.map((a) => [a.id, a]));

    // Distinct (arm, subject) pairs with an effective assignment AND students
    // enrolled in the arm — an assigned arm with no students owes nothing.
    const pairs = new Map<string, { armId: string; subjectId: string; subjectName: string }>();
    for (const as of ctx.assignments) {
      if (!armById.has(as.class_arm_id)) continue;
      pairs.set(pairKey(as.class_arm_id, as.subject_id), {
        armId: as.class_arm_id,
        subjectId: as.subject_id,
        subjectName: as.subject_name,
      });
    }

    const enteredByPair = new Map<string, { n: number; subjectName: string }>();
    for (const sc of ctx.scoreCounts) {
      const k = pairKey(sc.class_arm_id, sc.subject_id);
      const cur = enteredByPair.get(k) ?? { n: 0, subjectName: sc.subject_name };
      cur.n += sc.n;
      enteredByPair.set(k, cur);
    }
    const assessByPair = new Map(assessmentRows.map((r) => [pairKey(r.class_arm_id, r.subject_id), r]));

    const rows: ScoreEntryRowDto[] = [...pairs.values()]
      .map((p) => {
        const arm = armById.get(p.armId)!;
        const k = pairKey(p.armId, p.subjectId);
        return {
          groupId: p.armId,
          label: arm.name,
          classLevelName: arm.level_name,
          subjectId: p.subjectId,
          subjectName: p.subjectName,
          enrolledCount: arm.enrolled,
          componentCount: ctx.componentCount,
          slotsExpected: arm.enrolled * ctx.componentCount,
          slotsEntered: enteredByPair.get(k)?.n ?? 0,
          studentsWithScores: assessByPair.get(k)?.with_scores ?? 0,
          studentsSignedOff: assessByPair.get(k)?.signed_off ?? 0,
        };
      })
      .sort(
        (a, b) =>
          ctx.arms.findIndex((x) => x.id === a.groupId) - ctx.arms.findIndex((x) => x.id === b.groupId) ||
          a.subjectName.localeCompare(b.subjectName),
      );

    // D35 — scores with no effective assignment are reported, never silently
    // dropped and never counted against an expectation nobody was given.
    const unassigned: UnassignedScoresRowDto[] = [];
    for (const [k, v] of enteredByPair) {
      if (pairs.has(k)) continue;
      const [armId, subjectId] = k.split("|");
      unassigned.push({
        groupId: armId,
        label: armById.get(armId)?.name ?? "Unknown class",
        subjectId,
        subjectName: v.subjectName,
        slotsEntered: v.n,
      });
    }
    unassigned.sort((a, b) => a.label.localeCompare(b.label) || a.subjectName.localeCompare(b.subjectName));

    return {
      rows,
      unassigned,
      totals: {
        slotsExpected: rows.reduce((s, r) => s + r.slotsExpected, 0),
        slotsEntered: rows.reduce((s, r) => s + r.slotsEntered, 0),
      },
    };
  }

  private buildReportCards(
    ctx: TermContext,
    cardRows: Array<{ class_arm_id: string; status: string | null; n: number }>,
  ): NonNullable<CompletenessReportDto["reportCards"]> {
    const rows: ReportCardPipelineRowDto[] = ctx.arms.map((a) => ({
      groupId: a.id,
      label: a.name,
      classLevelName: a.level_name,
      enrolledCount: a.enrolled,
      byStatus: emptyByStatus(),
      studentsWithoutCard: 0,
    }));
    const rowByArm = new Map(rows.map((r) => [r.groupId, r]));
    for (const c of cardRows) {
      const row = rowByArm.get(c.class_arm_id);
      if (!row) continue;
      if (c.status === null) row.studentsWithoutCard += c.n;
      else if (c.status in row.byStatus) row.byStatus[c.status as keyof typeof row.byStatus] += c.n;
    }
    const totals = { byStatus: emptyByStatus(), studentsWithoutCard: 0 };
    for (const r of rows) {
      totals.studentsWithoutCard += r.studentsWithoutCard;
      for (const k of REPORT_CARD_STATUS_KEYS) totals.byStatus[k] += r.byStatus[k];
    }
    return { rows, totals };
  }

  private buildTeacherRows(
    ctx: TermContext,
    teachers: Array<{ id: string; first_name: string; last_name: string }>,
  ): TeacherActivityRowDto[] {
    const byArm = this.registerDates(ctx);
    const armById = new Map(ctx.arms.map((a) => [a.id, a]));
    const expectedPerArm = ctx.days.dto.schoolDayCount;

    // Registers this person marked: distinct (arm, date) they keyed, on any day in range.
    const markedArmDays = new Map<string, Set<string>>();
    const lastMarked = new Map<string, Date>();
    for (const m of ctx.marks) {
      const s = markedArmDays.get(m.marked_by) ?? new Set<string>();
      s.add(`${m.class_arm_id}|${m.d}`);
      markedArmDays.set(m.marked_by, s);
      const prev = lastMarked.get(m.marked_by);
      if (!prev || m.last_marked > prev) lastMarked.set(m.marked_by, m.last_marked);
    }

    const enteredByPair = new Map<string, number>();
    const enteredByPersonPair = new Map<string, number>();
    const lastEntered = new Map<string, Date>();
    for (const sc of ctx.scoreCounts) {
      const k = pairKey(sc.class_arm_id, sc.subject_id);
      enteredByPair.set(k, (enteredByPair.get(k) ?? 0) + sc.n);
      enteredByPersonPair.set(`${sc.entered_by}|${k}`, sc.n);
      const prev = lastEntered.get(sc.entered_by);
      if (!prev || sc.last_entered > prev) lastEntered.set(sc.entered_by, sc.last_entered);
    }

    return teachers.map((t) => {
      // Form arms WITH students this term — registers are attributed to the arm (D37).
      const formArms = ctx.arms.filter((a) => a.class_teacher_id === t.id);
      const myPairs = new Set(
        ctx.assignments
          .filter((a) => a.teacher_id === t.id && armById.has(a.class_arm_id))
          .map((a) => pairKey(a.class_arm_id, a.subject_id)),
      );
      let slotsExpected = 0;
      let slotsEntered = 0;
      let slotsEnteredByMe = 0;
      for (const k of myPairs) {
        const arm = armById.get(k.split("|")[0])!;
        slotsExpected += arm.enrolled * ctx.componentCount;
        slotsEntered += enteredByPair.get(k) ?? 0;
        slotsEnteredByMe += enteredByPersonPair.get(`${t.id}|${k}`) ?? 0;
      }
      return {
        userId: t.id,
        name: `${t.first_name} ${t.last_name}`,
        formArms: formArms.map((a) => a.name),
        formArmRegistersExpected: formArms.length * expectedPerArm,
        formArmRegistersTaken: formArms.reduce((s, a) => s + (byArm.get(a.id)?.onSchoolDays.size ?? 0), 0),
        registersMarkedByThisPerson: markedArmDays.get(t.id)?.size ?? 0,
        assignmentCount: myPairs.size,
        assignedSlotsExpected: slotsExpected,
        assignedSlotsEntered: slotsEntered,
        assignedSlotsEnteredByThisPerson: slotsEnteredByMe,
        lastRegisterMarkedAt: lastMarked.get(t.id)?.toISOString() ?? null,
        lastScoreEnteredAt: lastEntered.get(t.id)?.toISOString() ?? null,
      };
    });
  }
}
