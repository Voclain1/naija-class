import { Injectable, Logger } from "@nestjs/common";

import {
  INSIGHTS_NARRATION_PROMPT,
  INSIGHTS_NARRATION_SCHEMA,
  INSIGHTS_NARRATION_SYSTEM,
  INSIGHTS_ROUTER_PROMPT,
  INSIGHTS_ROUTER_SYSTEM,
  buildInsightsRouterSchema,
  renderInsightsNarrationPrompt,
  renderInsightsRouterPrompt,
} from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import {
  ForbiddenError,
  INSIGHT_ATTENDANCE_THRESHOLD,
  INSIGHT_INTENTS,
  INSIGHT_INTENT_DESCRIPTIONS,
  INSIGHT_PASS_MARK,
  NotFoundError,
  type AskInsightInput,
  type AskInsightResultDto,
  type AtRiskStudentDto,
  type AttendanceConcernDto,
  type ClassPerformanceDto,
  type InsightData,
  type InsightIntent,
  type SubjectPerformanceDto,
} from "@school-kit/types";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { AI_ERROR_CODES } from "../../common/ai/ai.constants.js";
import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";

// ---------------------------------------------------------------------------
// Admin insights — Phase 5 / Slice 8.
//
// An admin asks a question in their own words. The model picks WHICH report
// answers it; SQL computes the report; the model writes a short paragraph over
// the computed figures. Three steps, and the middle one is the only place a
// number is ever produced.
//
// WHY THIS SHAPE RATHER THAN LETTING THE MODEL QUERY (the alternative that was
// considered and rejected): a model that chooses what to query is a model that
// can return a number nobody computed. This surface is read by an owner
// deciding which class needs another teacher and which subject needs
// intervention. A wrong sentence is embarrassing; a wrong number is a staffing
// decision made on fiction. With a closed intent set, the worst case is that
// the question was routed to the wrong report — which the response surfaces
// explicitly (`intent` is echoed to the UI) rather than hiding behind fluent
// prose.
//
// It is also the only defensible shape given phase-5.md §9: this codebase has
// no content-quality evals, and nothing would catch a plausible-looking
// fabricated figure.
//
// TWO CALLS PER QUESTION, both Haiku (D7). Deliberate, not an oversight: one
// combined call would have to be trusted to route AND narrate in one output,
// which puts the routing decision and the prose in the same token stream and
// makes a misroute invisible. Two calls also mean the narration is skippable —
// if it fails or the budget runs out, the figures are already computed and
// still render (answer: null). The report survives the AI being unavailable.
//
// TRANSACTION DISCIPLINE (D1): no LLM call inside withTenant. The router call
// happens before any transaction opens, the SQL runs in one short transaction,
// and the narration call happens after it closes.
// ---------------------------------------------------------------------------

// How many rows each report returns. Small on purpose: this is a triage
// surface, not an export. A head teacher acting on "the worst 15" is the point;
// a 400-row table is the gradebook they already have.
const ROW_LIMIT = 15;

const REPORT_LABELS: Record<InsightIntent, string> = {
  "at-risk-students": "Students at risk",
  "underperforming-classes": "Class performance",
  "weakest-subjects": "Subject performance",
  "attendance-concerns": "Attendance concerns",
};

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(private readonly ai: AiGenerationService) {}

  async ask(authCtx: AuthContext, input: AskInsightInput): Promise<AskInsightResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    if (!this.ai.isConfigured()) {
      // Unlike the narration step below, routing cannot be skipped — without
      // it there is no report to run. Fails fast rather than guessing an
      // intent, because guessing here means confidently answering a question
      // the admin did not ask.
      throw new ForbiddenError(
        AI_ERROR_CODES.NOT_CONFIGURED,
        "AI is not configured on this deployment.",
      );
    }

    const termName = await withTenant(authCtx.schoolId, async (db) => {
      const term = await db.term.findUnique({
        where: { id: input.termId },
        select: { name: true },
      });
      if (!term) throw new NotFoundError("Term not found.");
      return term.name;
    });

    // ---- 1. route (no transaction open) -----------------------------------
    const routed = await this.route(authCtx, input.question);

    if (routed.unsupported) {
      return {
        intent: routed.intent,
        unsupported: true,
        answer: null,
        data: null,
        termId: input.termId,
        termName,
      };
    }

    // ---- 2. compute (one short transaction, no LLM inside) ----------------
    const data = await this.runReport(authCtx, routed.intent, input.termId);

    // ---- 3. narrate (transaction closed; failure is non-fatal) ------------
    const answer = await this.narrate(authCtx, input.question, termName, routed.intent, data);

    return {
      intent: routed.intent,
      unsupported: false,
      answer,
      data,
      termId: input.termId,
      termName,
    };
  }

  // =========================================================================
  // 1. Routing
  // =========================================================================
  private async route(
    authCtx: AuthContext,
    question: string,
  ): Promise<{ intent: InsightIntent; unsupported: boolean }> {
    const result = await this.ai.generate({
      schoolId: authCtx.schoolId,
      userId: authCtx.userId,
      prompt: INSIGHTS_ROUTER_PROMPT,
      system: INSIGHTS_ROUTER_SYSTEM,
      userContent: renderInsightsRouterPrompt({
        question,
        intents: INSIGHT_INTENTS.map((name) => ({
          name,
          description: INSIGHT_INTENT_DESCRIPTIONS[name],
        })),
      }),
      jsonSchema: buildInsightsRouterSchema(INSIGHT_INTENTS),
    });

    const parsed = this.parseRouterOutput(result.text);
    if (!parsed) {
      // Unparseable routing is treated as "not supported" rather than thrown:
      // the admin gets an honest "I can't answer that" instead of a 500, and
      // the alternative (defaulting to some intent) would answer a question
      // nobody asked.
      this.logger.warn(
        `insights: unparseable router output (stop reason: ${result.stopReason ?? "unknown"})`,
      );
      return { intent: INSIGHT_INTENTS[0], unsupported: true };
    }
    return parsed;
  }

  // Validates against the closed set rather than trusting the schema to have
  // been honoured. Structured output makes an out-of-enum value very unlikely;
  // this makes it impossible for one to reach the switch in runReport().
  private parseRouterOutput(text: string): { intent: InsightIntent; unsupported: boolean } | null {
    try {
      const parsed: unknown = JSON.parse(text.trim());
      if (!parsed || typeof parsed !== "object") return null;
      const obj = parsed as { intent?: unknown; unsupported?: unknown };
      const unsupported = obj.unsupported === true;
      const intent = INSIGHT_INTENTS.find((i) => i === obj.intent);
      if (!intent) return unsupported ? { intent: INSIGHT_INTENTS[0], unsupported: true } : null;
      return { intent, unsupported };
    } catch {
      return null;
    }
  }

  // =========================================================================
  // 2. The reports. Every figure below is computed here, in SQL.
  // =========================================================================
  private async runReport(
    authCtx: AuthContext,
    intent: InsightIntent,
    termId: string,
  ): Promise<InsightData> {
    switch (intent) {
      case "at-risk-students":
        return { intent, rows: await this.atRiskStudents(authCtx.schoolId, termId) };
      case "underperforming-classes":
        return { intent, rows: await this.classPerformance(authCtx.schoolId, termId) };
      case "weakest-subjects":
        return { intent, rows: await this.subjectPerformance(authCtx.schoolId, termId) };
      case "attendance-concerns":
        return { intent, rows: await this.attendanceConcerns(authCtx.schoolId, termId) };
    }
  }

  private async atRiskStudents(schoolId: string, termId: string): Promise<AtRiskStudentDto[]> {
    return withTenant(schoolId, async (db) => {
      const assessments = await db.assessment.findMany({
        where: { termId },
        select: { studentId: true, totalScore: true, classArmId: true },
      });
      if (assessments.length === 0) return [];

      const attendance = await db.attendanceRecord.findMany({
        where: { termId },
        select: { studentId: true, status: true },
      });

      const byStudent = new Map<
        string,
        { total: number; count: number; below: number; classArmId: string }
      >();
      for (const a of assessments) {
        const e = byStudent.get(a.studentId) ?? {
          total: 0,
          count: 0,
          below: 0,
          classArmId: a.classArmId,
        };
        e.total += a.totalScore;
        e.count += 1;
        if (a.totalScore < INSIGHT_PASS_MARK) e.below += 1;
        byStudent.set(a.studentId, e);
      }

      const attByStudent = new Map<string, { marked: number; attended: number }>();
      for (const r of attendance) {
        const e = attByStudent.get(r.studentId) ?? { marked: 0, attended: 0 };
        e.marked += 1;
        // Same (PRESENT+LATE)/daysMarked policy as AttendanceService and every
        // other attendance rate in the product — a late child was in school.
        if (r.status === "PRESENT" || r.status === "LATE") e.attended += 1;
        attByStudent.set(r.studentId, e);
      }

      const candidates = [...byStudent.entries()]
        .map(([studentId, s]) => {
          const att = attByStudent.get(studentId);
          return {
            studentId,
            classArmId: s.classArmId,
            averageScore: Math.round(s.total / s.count),
            subjectsBelowPass: s.below,
            attendanceRate: att && att.marked > 0 ? Math.round((att.attended * 100) / att.marked) : null,
          };
        })
        // "At risk" is EITHER signal, not both: a child scoring 35% with
        // perfect attendance is at risk, and so is a child averaging 55% who
        // has missed a third of the term. Requiring both would filter out
        // exactly the students an early-warning report exists to catch.
        .filter(
          (s) =>
            s.averageScore < 50 ||
            (s.attendanceRate !== null && s.attendanceRate < INSIGHT_ATTENDANCE_THRESHOLD),
        )
        .sort((a, b) => a.averageScore - b.averageScore)
        .slice(0, ROW_LIMIT);

      if (candidates.length === 0) return [];

      const [students, arms] = await Promise.all([
        db.student.findMany({
          where: { id: { in: candidates.map((c) => c.studentId) } },
          select: { id: true, firstName: true, lastName: true },
        }),
        db.classArm.findMany({
          where: { id: { in: [...new Set(candidates.map((c) => c.classArmId))] } },
          select: { id: true, name: true, classLevel: { select: { name: true } } },
        }),
      ]);

      const studentById = new Map(students.map((s) => [s.id, s]));
      const armLabel = new Map(arms.map((a) => [a.id, `${a.classLevel.name} ${a.name}`]));

      return candidates.flatMap((c) => {
        const s = studentById.get(c.studentId);
        if (!s) return [];
        return [
          {
            studentId: c.studentId,
            firstName: s.firstName,
            lastName: s.lastName,
            classArmLabel: armLabel.get(c.classArmId) ?? "Unknown class",
            averageScore: c.averageScore,
            attendanceRate: c.attendanceRate,
            subjectsBelowPass: c.subjectsBelowPass,
          },
        ];
      });
    });
  }

  private async classPerformance(schoolId: string, termId: string): Promise<ClassPerformanceDto[]> {
    return withTenant(schoolId, async (db) => {
      const [assessments, attendance, arms, enrollments] = await Promise.all([
        db.assessment.findMany({ where: { termId }, select: { classArmId: true, totalScore: true } }),
        db.attendanceRecord.findMany({ where: { termId }, select: { classArmId: true, status: true } }),
        db.classArm.findMany({
          select: { id: true, name: true, classLevel: { select: { name: true } } },
        }),
        db.enrollment.groupBy({ by: ["classArmId"], where: { termId, status: "ENROLLED" }, _count: true }),
      ]);

      const scores = new Map<string, { total: number; count: number }>();
      for (const a of assessments) {
        const e = scores.get(a.classArmId) ?? { total: 0, count: 0 };
        e.total += a.totalScore;
        e.count += 1;
        scores.set(a.classArmId, e);
      }

      const att = new Map<string, { marked: number; attended: number }>();
      for (const r of attendance) {
        const e = att.get(r.classArmId) ?? { marked: 0, attended: 0 };
        e.marked += 1;
        if (r.status === "PRESENT" || r.status === "LATE") e.attended += 1;
        att.set(r.classArmId, e);
      }

      const enrolled = new Map(enrollments.map((e) => [e.classArmId, e._count]));

      return arms
        .map((arm) => {
          const s = scores.get(arm.id);
          const a = att.get(arm.id);
          return {
            classArmId: arm.id,
            label: `${arm.classLevel.name} ${arm.name}`,
            studentCount: enrolled.get(arm.id) ?? 0,
            averageScore: s && s.count > 0 ? Math.round(s.total / s.count) : null,
            attendanceRate: a && a.marked > 0 ? Math.round((a.attended * 100) / a.marked) : null,
          };
        })
        // Arms with no scores at all are dropped rather than shown as null and
        // sorted to the bottom: "no marks entered yet" is not underperformance,
        // and mixing the two makes the report untrustworthy early in a term.
        .filter((r) => r.averageScore !== null)
        .sort((a, b) => (a.averageScore ?? 0) - (b.averageScore ?? 0))
        .slice(0, ROW_LIMIT);
    });
  }

  private async subjectPerformance(
    schoolId: string,
    termId: string,
  ): Promise<SubjectPerformanceDto[]> {
    return withTenant(schoolId, async (db) => {
      const assessments = await db.assessment.findMany({
        where: { termId },
        select: { subjectId: true, totalScore: true },
      });
      if (assessments.length === 0) return [];

      const agg = new Map<string, { total: number; count: number; below: number }>();
      for (const a of assessments) {
        const e = agg.get(a.subjectId) ?? { total: 0, count: 0, below: 0 };
        e.total += a.totalScore;
        e.count += 1;
        if (a.totalScore < INSIGHT_PASS_MARK) e.below += 1;
        agg.set(a.subjectId, e);
      }

      const subjects = await db.subject.findMany({
        where: { id: { in: [...agg.keys()] } },
        select: { id: true, name: true },
      });
      const nameById = new Map(subjects.map((s) => [s.id, s.name]));

      return [...agg.entries()]
        .map(([subjectId, e]) => ({
          subjectId,
          name: nameById.get(subjectId) ?? "Unknown subject",
          averageScore: Math.round(e.total / e.count),
          scoredStudentCount: e.count,
          belowPassCount: e.below,
        }))
        .sort((a, b) => a.averageScore - b.averageScore)
        .slice(0, ROW_LIMIT);
    });
  }

  private async attendanceConcerns(
    schoolId: string,
    termId: string,
  ): Promise<AttendanceConcernDto[]> {
    return withTenant(schoolId, async (db) => {
      const [attendance, arms] = await Promise.all([
        db.attendanceRecord.findMany({
          where: { termId },
          select: { classArmId: true, studentId: true, status: true },
        }),
        db.classArm.findMany({
          select: { id: true, name: true, classLevel: { select: { name: true } } },
        }),
      ]);
      if (attendance.length === 0) return [];

      const byArm = new Map<string, { marked: number; attended: number }>();
      const byStudent = new Map<string, { armId: string; marked: number; attended: number }>();

      for (const r of attendance) {
        const arm = byArm.get(r.classArmId) ?? { marked: 0, attended: 0 };
        const stu = byStudent.get(r.studentId) ?? { armId: r.classArmId, marked: 0, attended: 0 };
        const present = r.status === "PRESENT" || r.status === "LATE";
        arm.marked += 1;
        stu.marked += 1;
        if (present) {
          arm.attended += 1;
          stu.attended += 1;
        }
        byArm.set(r.classArmId, arm);
        byStudent.set(r.studentId, stu);
      }

      const belowByArm = new Map<string, number>();
      for (const s of byStudent.values()) {
        if (s.marked === 0) continue;
        const rate = (s.attended * 100) / s.marked;
        if (rate < INSIGHT_ATTENDANCE_THRESHOLD) {
          belowByArm.set(s.armId, (belowByArm.get(s.armId) ?? 0) + 1);
        }
      }

      const armLabel = new Map(arms.map((a) => [a.id, `${a.classLevel.name} ${a.name}`]));

      return [...byArm.entries()]
        .map(([classArmId, a]) => ({
          classArmId,
          label: armLabel.get(classArmId) ?? "Unknown class",
          attendanceRate: a.marked > 0 ? Math.round((a.attended * 100) / a.marked) : null,
          studentsBelowThreshold: belowByArm.get(classArmId) ?? 0,
          daysMarked: a.marked,
        }))
        .sort((x, y) => (x.attendanceRate ?? 100) - (y.attendanceRate ?? 100))
        .slice(0, ROW_LIMIT);
    });
  }

  // =========================================================================
  // 3. Narration — over computed figures only, and never fatal.
  // =========================================================================
  private async narrate(
    authCtx: AuthContext,
    question: string,
    termName: string,
    intent: InsightIntent,
    data: InsightData,
  ): Promise<string | null> {
    const figures = this.toFigures(data);

    try {
      const result = await this.ai.generate({
        schoolId: authCtx.schoolId,
        userId: authCtx.userId,
        prompt: INSIGHTS_NARRATION_PROMPT,
        system: INSIGHTS_NARRATION_SYSTEM,
        userContent: renderInsightsNarrationPrompt({
          question,
          termName,
          reportLabel: REPORT_LABELS[intent],
          figures,
        }),
        jsonSchema: INSIGHTS_NARRATION_SCHEMA,
      });
      return this.parseAnswer(result.text);
    } catch (err) {
      // Swallowed deliberately. The figures are already computed and the table
      // renders without prose — a budget exhaustion or a transient API failure
      // should degrade the answer, not lose the report. This is the payoff for
      // splitting routing and narration into two calls.
      this.logger.warn(`insights: narration failed, returning figures only: ${String(err)}`);
      return null;
    }
  }

  // The PII boundary. Rows carry student names (they go to the admin's
  // browser); these strings do not. Names are deliberately dropped here rather
  // than filtered downstream — the model is never handed a structure that
  // contains one.
  private toFigures(data: InsightData): string[] {
    switch (data.intent) {
      case "at-risk-students": {
        // Individual students are reported as an aggregate ONLY. There is no
        // per-student line, because a per-student line is a student record
        // reaching the model even without a name attached.
        const rows = data.rows;
        if (rows.length === 0) return [];
        const avg = Math.round(rows.reduce((s, r) => s + (r.averageScore ?? 0), 0) / rows.length);
        const lowAttendance = rows.filter(
          (r) => r.attendanceRate !== null && r.attendanceRate < INSIGHT_ATTENDANCE_THRESHOLD,
        ).length;
        const byArm = new Map<string, number>();
        for (const r of rows) byArm.set(r.classArmLabel, (byArm.get(r.classArmLabel) ?? 0) + 1);
        return [
          `${rows.length} students flagged as at risk`,
          `their average score across subjects is ${avg}%`,
          `${lowAttendance} of them are also below ${INSIGHT_ATTENDANCE_THRESHOLD}% attendance`,
          ...[...byArm.entries()].map(([label, n]) => `${label}: ${n} flagged`),
        ];
      }
      case "underperforming-classes":
        return data.rows.map(
          (r) =>
            `${r.label}: average ${r.averageScore}%, attendance ${r.attendanceRate ?? "not recorded"}${r.attendanceRate === null ? "" : "%"}, ${r.studentCount} students`,
        );
      case "weakest-subjects":
        return data.rows.map(
          (r) =>
            `${r.name}: average ${r.averageScore}%, ${r.belowPassCount} of ${r.scoredStudentCount} results below ${INSIGHT_PASS_MARK}%`,
        );
      case "attendance-concerns":
        return data.rows.map(
          (r) =>
            `${r.label}: attendance ${r.attendanceRate ?? "not recorded"}${r.attendanceRate === null ? "" : "%"}, ${r.studentsBelowThreshold} students below ${INSIGHT_ATTENDANCE_THRESHOLD}%, ${r.daysMarked} register entries`,
        );
    }
  }

  private parseAnswer(text: string): string | null {
    const trimmed = text.trim();
    if (trimmed.length === 0) return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && "answer" in parsed) {
        const value = (parsed as { answer: unknown }).answer;
        if (typeof value === "string" && value.trim().length > 0) return value.trim();
      }
      return null;
    } catch {
      return trimmed;
    }
  }
}
