import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Queue } from "bullmq";

import {
  PARENT_WEEKLY_SUMMARY_PROMPT,
  PARENT_WEEKLY_SUMMARY_SCHEMA,
  PARENT_WEEKLY_SUMMARY_SYSTEM,
  renderParentWeeklySummaryPrompt,
  type ParentSummaryScore,
} from "@school-kit/ai";
import { basePrisma, withGuardian, withTenant } from "@school-kit/db";
import {
  ForbiddenError,
  type ListParentSummariesInput,
  type ParentSummaryRowDto,
  type ParentSummarySettingsDto,
  type PortalParentSummaryDto,
  type PortalParentSummaryListResponse,
} from "@school-kit/types";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { AI_ERROR_CODES } from "../../common/ai/ai.constants.js";
import type { AuthContext } from "../../common/auth/auth-context.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { EmailService } from "../../common/email/email.service.js";
import { AI_JOB_PARENT_SUMMARY, AI_QUEUE } from "../../common/queue/index.js";

// ---------------------------------------------------------------------------
// Weekly parent progress summary — Phase 5 / Slice 5.
//
// THE THING THAT MAKES THIS SLICE DIFFERENT: its output reaches a parent with
// no staff member in between (phase-5.md D16). Slices 3 and 4 write a
// suggestion that a teacher must explicitly accept; there is no equivalent
// step here, by decision. Two consequences run through this whole file:
//
//   1. School.parentSummaryEnabled (default FALSE) is the ONLY gate. Every
//      path that can produce a summary re-reads it — the cron sweep filters on
//      it, and generateForStudent re-checks it at execution time, because a
//      school can switch the feature off between a Monday-morning enqueue and
//      the worker draining the job minutes later. A summary generated after
//      the school said stop is exactly the failure the opt-in exists to
//      prevent, and "the sweep already checked" is not good enough when the
//      two are minutes apart.
//
//   2. Nothing here is a draft. A written row is immediately visible to the
//      guardian, so a row is only ever written when there is something true to
//      say — see the quiet-week skip below.
//
// TRANSACTION DISCIPLINE (D1) is identical to slices 3-4: read (tx) → generate
// (NO tx) → write (tx). An LLM call never happens inside withTenant, and this
// service is NOT wrapped in tenantWorker for the same reason.
//
// COST SHAPE, which is why the skips matter more here than anywhere else in
// the phase: this is the only AI feature with a STANDING weekly volume. A
// 400-student school is ~400 calls a week, ~1,600 a month, against a default
// budget of 2,000,000 tokens. At this prompt's ceiling (250 output tokens plus
// a short input) that is comfortably inside the default — roughly 5-8% of it —
// but it is the first feature where the arithmetic had to be done rather than
// waved at, and it stacks on top of report comments in the same month. If a
// school ever runs a much larger roll, DEFAULT_MONTHLY_TOKEN_BUDGET is the
// number to revisit, not this prompt's maxTokens.
// ---------------------------------------------------------------------------

// Monday 05:30 UTC = 06:30 in Lagos (WAT, UTC+1, no DST) — a parent's Monday
// morning, covering the week that just ended. Deliberately after the two
// existing daily crons (00:05 overdue invoices, 00:15 onboarding nudge) rather
// than alongside them: those are quiet database sweeps, this one fans out to
// the AI queue and sends email, and there is no reason for the three to
// contend at the same minute.
const WEEKLY_CRON = "30 5 * * 1";

// A week is only worth summarising if SOMETHING happened in it. Sending
// "nothing to report" every Monday is how a channel trains parents to ignore
// it — and it would also spend real budget to say nothing. The threshold is
// deliberately low rather than clever: any score entered, or any absence or
// lateness. A full-attendance week with no new scores is silence, correctly.
function isWeekWorthSummarising(input: {
  scoreCount: number;
  daysAbsent: number;
  daysLate: number;
}): boolean {
  return input.scoreCount > 0 || input.daysAbsent > 0 || input.daysLate > 0;
}

// Monday 00:00 UTC of the week containing `now`, then stepped back one week —
// the week a Monday-morning cron is reporting on is the one that just closed,
// never the one that just opened.
//
// UTC, and @db.Date, for the same reason as the AI budget period: a week
// boundary is an accounting boundary, not a school-day boundary, and every row
// must be comparable against the same clock. See CLAUDE.md's DATE convention.
export function previousWeekStart(now: Date = new Date()): Date {
  const day = now.getUTCDay(); // 0 = Sunday
  // Days since this week's Monday. Sunday (0) is 6 days after Monday, not -1.
  const sinceMonday = (day + 6) % 7;
  const thisMonday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - sinceMonday,
  );
  return new Date(thisMonday - 7 * 24 * 60 * 60 * 1000);
}

export interface ParentSummaryJobData {
  schoolId: string;
  studentId: string;
  // ISO date string (YYYY-MM-DD). Serialised through BullMQ as JSON, so a Date
  // would arrive as a string anyway — carrying it explicitly as one makes the
  // round-trip visible instead of relying on the worker to re-parse silently.
  weekStart: string;
}

@Injectable()
export class ParentSummariesService {
  private readonly logger = new Logger(ParentSummariesService.name);

  constructor(
    private readonly ai: AiGenerationService,
    private readonly email: EmailService,
    @InjectQueue(AI_QUEUE) private readonly queue: Queue,
  ) {}

  // =========================================================================
  // The weekly sweep. Cron entry point.
  // =========================================================================
  // schoolIds is an optional allow-list used by tests to scope the sweep,
  // exactly as FinanceService.transitionOverdueInvoices and
  // OnboardingNudgeService do — the production @Cron call passes nothing.
  @Cron(WEEKLY_CRON)
  async sweepWeeklySummaries(schoolIds?: string[], now: Date = new Date()): Promise<void> {
    // Platform-level short circuit. Without a configured key every job would
    // enqueue, run, fail on AI_NOT_CONFIGURED and retry — thousands of
    // pointless jobs a week across six schools. This is the same pre-flight
    // lesson slice 3 learned in browser verification, applied to a cron
    // instead of a button.
    if (!this.ai.isConfigured()) {
      this.logger.warn("parent-summary sweep: AI is not configured — skipping this week entirely");
      return;
    }

    const weekStart = previousWeekStart(now);

    let schools: Array<{ id: string }>;
    try {
      schools = await basePrisma.school.findMany({
        where: {
          status: "ACTIVE",
          // BOTH flags. parentSummaryEnabled is the feature's own opt-in
          // (D16); aiEnabled is the school-wide kill switch that must stop
          // every AI feature, this one included.
          parentSummaryEnabled: true,
          aiEnabled: true,
          ...(schoolIds?.length ? { id: { in: schoolIds } } : {}),
        },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(`parent-summary sweep: failed to list schools: ${String(err)}`);
      return;
    }

    let totalQueued = 0;

    for (const school of schools) {
      try {
        totalQueued += await this.enqueueSchool(school.id, weekStart);
      } catch (err) {
        // One school's failure must not abort the sweep for the other five.
        this.logger.error(`parent-summary sweep: school ${school.id} failed: ${String(err)}`);
      }
    }

    if (totalQueued > 0) {
      this.logger.log(
        `parent-summary sweep: queued ${totalQueued} summary/summaries across ${schools.length} school(s) for week ${weekStart.toISOString().slice(0, 10)}`,
      );
    }
  }

  // Enqueues one school's eligible students for one week. Returns the count.
  private async enqueueSchool(schoolId: string, weekStart: Date): Promise<number> {
    const studentIds = await withTenant(schoolId, async (db) => {
      // Currently-enrolled, active students only. A withdrawn or graduated
      // student's guardian should not receive a weekly note about a child who
      // is no longer at the school — an ordinary-looking bug that would be
      // actively distressing to receive.
      const enrollments = await db.enrollment.findMany({
        where: {
          withdrawnAt: null,
          student: { status: "ACTIVE" },
        },
        select: { studentId: true },
        distinct: ["studentId"],
      });
      if (enrollments.length === 0) return [];

      // Skip students who already have a row for this week. The unique
      // constraint would catch a duplicate write anyway, but catching it HERE
      // is what stops the school paying for a generation whose result is then
      // thrown away by a constraint violation — the budget is spent at the
      // call, not at the write.
      const existing = await db.parentSummary.findMany({
        where: { weekStart, studentId: { in: enrollments.map((e) => e.studentId) } },
        select: { studentId: true },
      });
      const done = new Set(existing.map((e) => e.studentId));

      return enrollments.map((e) => e.studentId).filter((id) => !done.has(id));
    });

    const isoWeek = weekStart.toISOString().slice(0, 10);

    for (const studentId of studentIds) {
      const data: ParentSummaryJobData = { schoolId, studentId, weekStart: isoWeek };
      // Stable job id — a re-run of the sweep (manual trigger, restart, a
      // second scheduler instance) cannot double-charge a school for the same
      // child's week. This is the queue-level half of the same idempotency the
      // unique constraint enforces at the DB level; both are wanted, because
      // they fail at different times and cost different amounts.
      await this.queue.add(AI_JOB_PARENT_SUMMARY, data, {
        jobId: `parent-summary:${schoolId}:${studentId}:${isoWeek}`,
      });
    }

    return studentIds.length;
  }

  // =========================================================================
  // The generation. Called by the processor only. Three phases (D1).
  // =========================================================================
  async generateForStudent(job: ParentSummaryJobData): Promise<void> {
    const weekStart = new Date(`${job.weekStart}T00:00:00.000Z`);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    // ---- 1. read ----------------------------------------------------------
    const context = await withTenant(job.schoolId, async (db) => {
      // Re-check the opt-in at EXECUTION time, not just at enqueue time. The
      // sweep may have queued hundreds of jobs minutes ago and an admin may
      // have switched the feature off since. Because this output is
      // unattended, "we already checked" is the wrong standard — this is the
      // only gate D16 leaves standing, so it gets checked at every point it
      // could have changed.
      const school = await db.school.findUnique({
        where: { id: job.schoolId },
        select: { parentSummaryEnabled: true, aiEnabled: true },
      });
      if (!school?.parentSummaryEnabled || !school.aiEnabled) return null;

      // Already written by a concurrent worker or an earlier run.
      const existing = await db.parentSummary.findFirst({
        where: { studentId: job.studentId, weekStart },
        select: { id: true },
      });
      if (existing) return null;

      const student = await db.student.findUnique({
        where: { id: job.studentId },
        select: { status: true },
      });
      if (!student || student.status !== "ACTIVE") return null;

      const [attendance, scores, enrollment] = await Promise.all([
        db.attendanceRecord.findMany({
          where: { studentId: job.studentId, date: { gte: weekStart, lt: weekEnd } },
          select: { status: true },
        }),
        // enteredAt, not the term boundary: "what did this week bring" is a
        // question about when the mark was RECORDED, which is what a parent
        // experiences as news.
        db.assessmentScore.findMany({
          where: { studentId: job.studentId, enteredAt: { gte: weekStart, lt: weekEnd } },
          select: {
            score: true,
            subjectId: true,
            // `label` is the human string ("First CA", "Project"); `key` is the
            // stable machine one. weight is the component's integer percent,
            // and AssessmentScore.score is already in those units (0..weight),
            // so the pair renders directly as "15 out of 20" with no
            // arithmetic — which is exactly the form the prompt asks for.
            component: { select: { label: true, weight: true } },
          },
        }),
        db.enrollment.findFirst({
          where: { studentId: job.studentId, withdrawnAt: null },
          select: { classArm: { select: { classLevel: { select: { name: true } } } } },
          orderBy: { enrolledAt: "desc" },
        }),
      ]);

      if (!enrollment) return null;

      const daysMarked = attendance.length;
      const daysPresent = attendance.filter((r) => r.status === "PRESENT").length;
      const daysAbsent = attendance.filter((r) => r.status === "ABSENT").length;
      const daysLate = attendance.filter((r) => r.status === "LATE").length;

      if (!isWeekWorthSummarising({ scoreCount: scores.length, daysAbsent, daysLate })) {
        return null;
      }

      // Subject names resolved separately — AssessmentScore.subjectId is a
      // plain scoping column, not a declared Prisma relation (same convention
      // as slices 3-4).
      const subjectNames = new Map(
        (
          await db.subject.findMany({
            where: { id: { in: scores.map((s) => s.subjectId) } },
            select: { id: true, name: true },
          })
        ).map((s) => [s.id, s.name]),
      );

      const rendered: ParentSummaryScore[] = scores.map((s) => ({
        subject: subjectNames.get(s.subjectId) ?? "Unknown subject",
        assessmentName: s.component.label,
        score: s.score,
        maxScore: s.component.weight,
      }));

      return {
        classLevel: enrollment.classArm.classLevel.name,
        daysMarked,
        daysPresent,
        daysAbsent,
        daysLate,
        scores: rendered,
      };
    });

    if (!context) {
      // Ordinary outcome, not an error: opted out mid-flight, already written,
      // no longer enrolled, or a quiet week. Logged at debug volume because on
      // a normal Monday this fires for most of the roll.
      this.logger.debug(
        `parent-summary: nothing to write for student ${job.studentId} week ${job.weekStart}`,
      );
      return;
    }

    // ---- 2. generate (no transaction open) --------------------------------
    const result = await this.ai.generate({
      schoolId: job.schoolId,
      // Null: cron-driven, no acting user. Exempt from the per-user daily call
      // cap by design (see GenerateParams), but NOT from the school's monthly
      // token budget, which still reserves and settles normally.
      userId: null,
      prompt: PARENT_WEEKLY_SUMMARY_PROMPT,
      system: PARENT_WEEKLY_SUMMARY_SYSTEM,
      userContent: renderParentWeeklySummaryPrompt(context),
      jsonSchema: PARENT_WEEKLY_SUMMARY_SCHEMA,
    });

    const summary = this.parseSummary(result.text);
    if (!summary) {
      // Throw rather than write an empty row: BullMQ retries, and a missing
      // note is recoverable next attempt whereas a blank one delivered to a
      // parent is not.
      throw new Error(
        `parent-summary: no summary in model output for student ${job.studentId} (stop reason: ${result.stopReason ?? "unknown"})`,
      );
    }

    // ---- 3. write ---------------------------------------------------------
    const created = await withTenant(job.schoolId, async (db) =>
      db.parentSummary.create({
        data: {
          schoolId: job.schoolId,
          studentId: job.studentId,
          weekStart,
          summary,
          promptVersion: PARENT_WEEKLY_SUMMARY_PROMPT.version,
        },
        select: { id: true },
      }),
    );

    // Delivery is deliberately AFTER the write and outside its transaction: a
    // failed email must not roll back a summary the portal can still show. The
    // row is the artifact; the email is a notification about it.
    await this.maybeEmail(job.schoolId, job.studentId, created.id, summary);
  }

  // =========================================================================
  // Email delivery. Best-effort by design.
  // =========================================================================
  private async maybeEmail(
    schoolId: string,
    studentId: string,
    summaryId: string,
    summary: string,
  ): Promise<void> {
    try {
      const targets = await withTenant(schoolId, async (db) => {
        const prefs = await db.notificationPreference.findFirst({
          where: { schoolId },
          select: { emailEnabled: true },
        });
        // No preference row = school never touched notification settings.
        // Default emailEnabled TRUE mirrors the column default, so a school
        // that opted INTO parent summaries gets them delivered rather than
        // silently generated and never sent.
        if (prefs && !prefs.emailEnabled) return null;

        const links = await db.studentGuardian.findMany({
          where: { studentId },
          select: { guardian: { select: { email: true } } },
        });

        const school = await db.school.findUnique({
          where: { id: schoolId },
          select: { name: true },
        });

        const emails = links
          .map((l) => l.guardian.email)
          .filter((e): e is string => typeof e === "string" && e.length > 0);

        return { emails, schoolName: school?.name ?? "Your child's school" };
      });

      if (!targets || targets.emails.length === 0) return;

      for (const to of targets.emails) {
        await this.email.send({
          to,
          subject: `Weekly update from ${targets.schoolName}`,
          html: this.renderEmail(targets.schoolName, summary),
        });
      }

      await withTenant(schoolId, (db) =>
        db.parentSummary.update({
          where: { id: summaryId },
          data: { emailedAt: new Date() },
        }),
      );
    } catch (err) {
      // Swallowed, not rethrown: the summary is already written and readable
      // in the portal. Rethrowing would make BullMQ retry the whole job, which
      // would hit the already-exists guard and — worse — could re-send to the
      // guardians whose address already succeeded in the loop above.
      // emailedAt stays null, which is exactly what "we could not push this
      // one" should look like.
      this.logger.error(
        `parent-summary: email delivery failed for summary ${summaryId}: ${String(err)}`,
      );
    }
  }

  private renderEmail(schoolName: string, summary: string): string {
    // Plain and small on purpose. Escaped because `summary` is model output —
    // it should never contain markup, but "should never" is not a reason to
    // interpolate an unescaped string into HTML.
    const safe = summary
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return [
      `<p>Here is this week's update from ${this.escape(schoolName)}.</p>`,
      `<p>${safe}</p>`,
      `<p style="color:#666;font-size:12px">You can see previous updates any time in the parent portal.</p>`,
    ].join("\n");
  }

  private escape(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // =========================================================================
  // Portal read (guardian-facing)
  // =========================================================================
  async listForGuardian(
    guardianCtx: GuardianAuthContext,
    studentId: string,
  ): Promise<PortalParentSummaryListResponse> {
    // withTenant + withGuardian composed, exactly as PortalStudentsService
    // does: the first is the school boundary, the second is the family
    // boundary within the school. RLS alone would happily return another
    // family's child in the same school (phase-4.md Decision B).
    const rows = await withTenant(guardianCtx.schoolId, (db) =>
      withGuardian(guardianCtx.guardianId, studentId, db, async (db2) =>
        db2.parentSummary.findMany({
          where: { studentId },
          select: { id: true, weekStart: true, summary: true },
          orderBy: { weekStart: "desc" },
          // A term's worth. A guardian scrolling further back than that is not
          // a use case anyone has asked for, and an unbounded list on a phone
          // is a slow page for no benefit.
          take: 12,
        }),
      ),
    );

    const data: PortalParentSummaryDto[] = rows.map((r) => ({
      id: r.id,
      weekStart: r.weekStart,
      summary: r.summary,
    }));
    return { data };
  }

  // =========================================================================
  // Staff read + settings
  // =========================================================================
  async list(
    authCtx: AuthContext,
    input: ListParentSummariesInput,
  ): Promise<ParentSummaryRowDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.parentSummary.findMany({
        where: input.studentId ? { studentId: input.studentId } : {},
        select: {
          id: true,
          studentId: true,
          weekStart: true,
          summary: true,
          emailedAt: true,
          promptVersion: true,
          createdAt: true,
        },
        orderBy: [{ weekStart: "desc" }, { createdAt: "desc" }],
        take: input.limit,
      });
      return rows;
    });
  }

  async getSettings(authCtx: AuthContext): Promise<ParentSummarySettingsDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const school = await withTenant(authCtx.schoolId, (db) =>
      db.school.findUnique({
        where: { id: authCtx.schoolId },
        select: { parentSummaryEnabled: true, aiEnabled: true },
      }),
    );

    return {
      enabled: school?.parentSummaryEnabled ?? false,
      aiEnabled: school?.aiEnabled ?? false,
      // Surfaced so a settings screen can distinguish "on but the platform
      // has no API key" from "on and working" — otherwise both look like
      // "enabled, but no summaries ever arrive".
      aiConfigured: this.ai.isConfigured(),
    };
  }

  async updateSettings(authCtx: AuthContext, enabled: boolean): Promise<ParentSummarySettingsDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    await withTenant(authCtx.schoolId, async (db) => {
      await db.school.update({
        where: { id: authCtx.schoolId },
        data: { parentSummaryEnabled: enabled },
      });
      // Audited because this is the switch that decides whether unattended AI
      // output reaches parents. "Who turned this on, and when?" must be
      // answerable to a school after the fact — it is the only human decision
      // in the whole feature.
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: enabled ? "parent-summary.enabled" : "parent-summary.disabled",
          entityType: "School",
          entityId: authCtx.schoolId,
        },
      });
    });

    return this.getSettings(authCtx);
  }

  // Manual re-run for a single school — the "we just switched it on, show me
  // what it produces" path, and the recovery path if a Monday sweep failed.
  // Gated on parent-summary.manage at the controller.
  async triggerNow(authCtx: AuthContext): Promise<{ queued: number }> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    if (!this.ai.isConfigured()) {
      throw new ForbiddenError(
        AI_ERROR_CODES.NOT_CONFIGURED,
        "AI is not configured on this deployment.",
      );
    }

    const school = await withTenant(authCtx.schoolId, (db) =>
      db.school.findUnique({
        where: { id: authCtx.schoolId },
        select: { parentSummaryEnabled: true, aiEnabled: true },
      }),
    );
    if (!school?.aiEnabled) {
      throw new ForbiddenError(AI_ERROR_CODES.DISABLED_SCHOOL, "AI is disabled for this school.");
    }
    if (!school.parentSummaryEnabled) {
      // Deliberately refused rather than treated as an implicit opt-in: the
      // switch is the control (D16), and a manual trigger must not be a way
      // around it.
      throw new ForbiddenError(
        "PARENT_SUMMARY_DISABLED",
        "Weekly parent summaries are switched off for this school.",
      );
    }

    const queued = await this.enqueueSchool(authCtx.schoolId, previousWeekStart());
    return { queued };
  }

  private parseSummary(text: string): string | null {
    const trimmed = text.trim();
    if (trimmed.length === 0) return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && "summary" in parsed) {
        const value = (parsed as { summary: unknown }).summary;
        if (typeof value === "string" && value.trim().length > 0) return value.trim();
      }
      return null;
    } catch {
      // Structured output should always give us JSON; a bare string is a
      // tolerable fallback rather than a discarded (already paid for)
      // generation. Same posture as FormCommentsService.parseComment.
      return trimmed;
    }
  }
}

// Exported for the spec. Both are pure functions of their inputs and hold no
// instance state, so they live outside the class and are testable without
// constructing the service or its three dependencies.
export const __testables = { isWeekWorthSummarising };
