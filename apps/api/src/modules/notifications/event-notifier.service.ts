import { Injectable, Logger } from "@nestjs/common";

import { withTenant } from "@school-kit/db";

import { CalendarService } from "../calendar/calendar.service";
import { computeSchoolDays } from "../reports/school-days";
import { NotificationDispatchService } from "./notification-dispatch.service";

// Who hears about what (docs/modules/notifications-v1.md N1).
//
// One service owns the audience for every event, so the report-card workflow
// and the payments service stay about report cards and payments. They say
// "this happened"; this decides who cares, and NotificationDispatchService
// decides how they are reached.
//
// Every method here is FIRE AND FORGET by contract (N7): it is called after
// the caller's transaction has committed, and it never throws. A release or a
// payment must not fail because Expo is slow, and a notification that failed
// is recoverable by opening the app — the thing it was about already happened.
//
// Every body is lockscreen-safe (N3): the title is the school's name and the
// body says WHAT happened, never whose it was or how much. A lock screen is
// public, and these are children's records.

export const EVENT = {
  resultsReleased: "results.released",
  paymentRecorded: "payment.recorded",
  registerNotTaken: "register.not-taken",
  marksNotEntered: "marks.not-entered",
  announcementPosted: "announcement.posted",
  attendanceAbsent: "attendance.absent",
} as const;

/**
 * How long an absence alert is held before it is sent
 * (`docs/modules/the-school-day.md` A4).
 *
 * A teacher mistypes a register, notices, and fixes it within the minute. An
 * absence told instantly cannot be recalled — the parent has already read
 * that their child is not in school and is already ringing the school. Almost
 * every correction happens inside this window, and the send re-reads the
 * record when it expires, so a correction costs nothing at all.
 */
export const ABSENCE_GRACE_MS = 15 * 60 * 1000;

@Injectable()
export class EventNotifierService {
  private readonly logger = new Logger(EventNotifierService.name);

  constructor(
    private readonly dispatch: NotificationDispatchService,
    private readonly calendar: CalendarService,
  ) {}

  /**
   * A class's report cards were released: tell each child's guardians and the
   * child themselves.
   *
   * `eventId` is the (term, arm) pair, so a re-release of the same class
   * notifies nobody twice, while next term's release is a different event.
   */
  async resultsReleased(args: { schoolId: string; termId: string; classArmId: string }): Promise<void> {
    await this.safely("resultsReleased", async () => {
      const { schoolName, studentIds, guardianIds } = await withTenant(args.schoolId, async (db) => {
        const school = await db.school.findUniqueOrThrow({
          where: { id: args.schoolId },
          select: { name: true },
        });
        const cards = await db.reportCard.findMany({
          where: { termId: args.termId, classArmId: args.classArmId, status: "RELEASED" },
          select: { studentId: true },
        });
        const ids = [...new Set(cards.map((card) => card.studentId))];
        const links = await db.studentGuardian.findMany({
          where: { studentId: { in: ids } },
          select: { guardianId: true },
        });
        // One notification per GUARDIAN, not per child: a parent with three
        // children in the class is told once (N6), and the app shows which.
        return {
          schoolName: school.name,
          studentIds: ids,
          guardianIds: [...new Set(links.map((link) => link.guardianId))],
        };
      });

      const eventId = `${args.termId}:${args.classArmId}`;
      for (const guardianId of guardianIds) {
        await this.dispatch.notifyOfEvent({
          schoolId: args.schoolId,
          principal: { type: "GUARDIAN", guardianId },
          eventType: EVENT.resultsReleased,
          eventId,
          title: schoolName,
          body: "Results have been released. Open the app to see them.",
          data: { screen: "results" },
        });
      }
      for (const studentId of studentIds) {
        await this.dispatch.notifyOfEvent({
          schoolId: args.schoolId,
          principal: { type: "STUDENT", studentId },
          eventType: EVENT.resultsReleased,
          eventId,
          title: schoolName,
          body: "Your results have been released.",
          data: { screen: "results" },
        });
      }
    });
  }

  /**
   * Money was received against a child's invoice: tell that child's guardians.
   *
   * This is a receipt of trust, and it is also how a family catches a payment
   * recorded against the wrong child — which is why it says an amount was
   * received at all, and why it names no amount on the lock screen.
   */
  async paymentRecorded(args: { schoolId: string; paymentId: string }): Promise<void> {
    await this.safely("paymentRecorded", async () => {
      const { schoolName, guardianIds } = await withTenant(args.schoolId, async (db) => {
        const payment = await db.payment.findUniqueOrThrow({
          where: { id: args.paymentId },
          select: { studentId: true, status: true },
        });
        if (payment.status !== "SUCCESS") return { schoolName: "", guardianIds: [] as string[] };
        const school = await db.school.findUniqueOrThrow({
          where: { id: args.schoolId },
          select: { name: true },
        });
        const links = await db.studentGuardian.findMany({
          where: { studentId: payment.studentId },
          select: { guardianId: true },
        });
        return { schoolName: school.name, guardianIds: [...new Set(links.map((l) => l.guardianId))] };
      });

      for (const guardianId of guardianIds) {
        await this.dispatch.notifyOfEvent({
          schoolId: args.schoolId,
          principal: { type: "GUARDIAN", guardianId },
          eventType: EVENT.paymentRecorded,
          eventId: args.paymentId,
          title: schoolName,
          body: "A school fees payment has been recorded. Open the app to see it.",
          data: { screen: "fees" },
        });
      }
    });
  }

  /**
   * Mid-morning: which form teachers have not taken today's register?
   *
   * Only on a real school day — weekends, holidays and breaks are excluded by
   * the same computeSchoolDays the completeness report uses, so a teacher is
   * never chased on a day the school was shut.
   *
   * `eventId` is the date, so a teacher hears once per day however many times
   * the sweep runs, and tomorrow is a new event.
   */
  async registersNotTaken(args: { schoolId: string; date: string }): Promise<void> {
    await this.safely("registersNotTaken", async () => {
      const context = await this.schoolDay(args.schoolId, args.date);
      if (!context || !context.isSchoolDay) return;

      const { schoolName, arms } = await withTenant(args.schoolId, async (db) => {
        const school = await db.school.findUniqueOrThrow({ where: { id: args.schoolId }, select: { name: true } });
        const withTeachers = await db.classArm.findMany({
          where: { isActive: true, classTeacherId: { not: null } },
          select: { id: true, classTeacherId: true },
        });
        const marked = await db.attendanceRecord.findMany({
          where: { date: new Date(`${args.date}T00:00:00.000Z`) },
          select: { classArmId: true },
          distinct: ["classArmId"],
        });
        const markedArms = new Set(marked.map((row) => row.classArmId));
        return {
          schoolName: school.name,
          arms: withTeachers.filter((arm) => !markedArms.has(arm.id)),
        };
      });

      // One notification per TEACHER, not per arm: a teacher who forms two
      // classes is told once and opens the app to see which.
      for (const teacherId of [...new Set(arms.map((arm) => arm.classTeacherId as string))]) {
        await this.dispatch.notifyOfEvent({
          schoolId: args.schoolId,
          principal: { type: "STAFF", userId: teacherId },
          eventType: EVENT.registerNotTaken,
          eventId: args.date,
          title: schoolName,
          body: "Today's register has not been taken.",
          data: { screen: "attendance" },
        });
      }
    });
  }

  /**
   * A week before the term ends: which teachers still have a subject with
   * nothing entered?
   *
   * NOT an invented per-assessment deadline — the schema has none. The term's
   * end date is the real deadline, and this says exactly that.
   *
   * `eventId` is the term, so a teacher hears once per term rather than once
   * a day for the last week.
   */
  async marksNotEntered(args: { schoolId: string; today: string; daysBefore: number }): Promise<void> {
    await this.safely("marksNotEntered", async () => {
      const due = await withTenant(args.schoolId, async (db) => {
        const term = await db.term.findFirst({
          where: { isCurrent: true },
          select: { id: true, name: true, endDate: true },
        });
        if (!term) return null;
        const endsOn = term.endDate.toISOString().slice(0, 10);
        const remindOn = new Date(Date.parse(`${endsOn}T00:00:00.000Z`) - args.daysBefore * 86_400_000)
          .toISOString()
          .slice(0, 10);
        // Exactly one day, not "within a week": eventId already makes it
        // once-per-term, and a single day keeps the sweep cheap.
        if (args.today !== remindOn) return null;

        const school = await db.school.findUniqueOrThrow({ where: { id: args.schoolId }, select: { name: true } });
        const assignments = await db.teacherAssignment.findMany({
          where: { isActive: true, OR: [{ termId: term.id }, { termId: null }] },
          select: { teacherId: true, classArmId: true, subjectId: true },
        });
        const entered = await db.assessment.findMany({
          where: { termId: term.id },
          select: { classArmId: true, subjectId: true },
          distinct: ["classArmId", "subjectId"],
        });
        const hasMarks = new Set(entered.map((row) => `${row.classArmId}:${row.subjectId}`));
        const teachers = new Set(
          assignments
            .filter((a) => !hasMarks.has(`${a.classArmId}:${a.subjectId}`))
            .map((a) => a.teacherId),
        );
        return { schoolName: school.name, termId: term.id, termName: term.name, teachers: [...teachers] };
      });
      if (!due) return;

      for (const teacherId of due.teachers) {
        await this.dispatch.notifyOfEvent({
          schoolId: args.schoolId,
          principal: { type: "STAFF", userId: teacherId },
          eventType: EVENT.marksNotEntered,
          eventId: due.termId,
          title: due.schoolName,
          body: `${due.termName} ends in a week and one of your subjects has no marks yet.`,
          data: { screen: "gradebook" },
        });
      }
    });
  }

  /** Today's term, and whether the school actually meets today. */
  /**
   * A child was marked absent today: tell their guardians
   * (`docs/modules/the-school-day.md` Part A).
   *
   * Four decisions are visible in the shape of this method:
   *
   *  - **ABSENT only** (A1). LATE and EXCUSED tell a parent what they told
   *    the school.
   *  - **One alert per GUARDIAN per DAY** (A2), so `eventId` is the date
   *    alone, not the child. A parent with three children off sick is told
   *    once, and the app shows which — the same collapse `resultsReleased`
   *    makes.
   *  - **No name in the body** (A3). N3, and the lockscreen is the reason: a
   *    phone face-up on a desk must not announce which child is missing. The
   *    cost is that a parent of three opens the app to find out, and that is
   *    the right side of the trade.
   *  - **Held, then re-checked** (A4). See ABSENCE_GRACE_MS and the
   *    processor's stillTrue().
   *
   * The student is deliberately NOT notified. They know.
   */
  async attendanceAbsent(args: {
    schoolId: string;
    date: string;
    absentStudentIds: readonly string[];
    /** The school's today, so a back-filled register stays silent. */
    today: string;
  }): Promise<void> {
    if (args.absentStudentIds.length === 0) return;
    // A register filled in for last Tuesday is record-keeping, not news. An
    // alert saying "today" about a week-old absence would be worse than
    // silence, and the parent has long since known.
    if (args.date !== args.today) return;

    await this.safely("attendanceAbsent", async () => {
      const { schoolName, guardianIds } = await withTenant(args.schoolId, async (db) => {
        const school = await db.school.findUniqueOrThrow({
          where: { id: args.schoolId },
          select: { name: true },
        });
        const links = await db.studentGuardian.findMany({
          where: { studentId: { in: [...args.absentStudentIds] } },
          select: { guardianId: true },
        });
        return { schoolName: school.name, guardianIds: [...new Set(links.map((l) => l.guardianId))] };
      });

      for (const guardianId of guardianIds) {
        await this.dispatch.notifyOfEvent({
          schoolId: args.schoolId,
          principal: { type: "GUARDIAN", guardianId },
          eventType: EVENT.attendanceAbsent,
          eventId: args.date,
          title: schoolName,
          body: "A child was marked absent today. Open the app to see.",
          data: { screen: "attendance" },
          delayMs: ABSENCE_GRACE_MS,
          verify: { kind: "guardian-child-absent", guardianId, date: args.date },
        });
      }
    });
  }

  private async schoolDay(
    schoolId: string,
    today: string,
  ): Promise<{ termId: string; isSchoolDay: boolean } | null> {
    return withTenant(schoolId, async (db) => {
      const term = await db.term.findFirst({
        where: { isCurrent: true },
        select: { id: true, startDate: true, endDate: true },
      });
      if (!term) return null;
      const school = await db.school.findUnique({ where: { id: schoolId }, select: { schoolWeekDays: true } });
      const termStart = term.startDate.toISOString().slice(0, 10);
      const termEnd = term.endDate.toISOString().slice(0, 10);
      // The same merged calendar every other surface reads (D27), so a public
      // holiday the school hid is excluded here too.
      const entries = await this.calendar.buildCalendar(db as never, schoolId, { from: termStart, to: termEnd });
      const { schoolDaySet } = computeSchoolDays(
        termStart,
        termEnd,
        today,
        entries,
        school?.schoolWeekDays ?? undefined,
      );
      return { termId: term.id, isSchoolDay: schoolDaySet.has(today) };
    });
  }

  /**
   * A school announcement was posted: tell its audience (announcements.md A3).
   *
   * The notification says an announcement ARRIVED and nothing about what it
   * says — the words live in the app (N3). An urgent one skips quiet hours,
   * which is the whole point of that flag.
   */
  async announcementPosted(args: { schoolId: string; announcementId: string }): Promise<void> {
    await this.safely("announcementPosted", async () => {
      const audience = await withTenant(args.schoolId, async (db) => {
        const announcement = await db.announcement.findUnique({
          where: { id: args.announcementId },
          select: { audience: true, classArmId: true, urgent: true, withdrawnAt: true },
        });
        if (!announcement || announcement.withdrawnAt) return null;
        const school = await db.school.findUniqueOrThrow({
          where: { id: args.schoolId },
          select: { name: true },
        });

        const guardianIds: string[] = [];
        const studentIds: string[] = [];
        const userIds: string[] = [];

        if (announcement.audience === "STAFF" || announcement.audience === "EVERYONE") {
          const staff = await db.user.findMany({ where: { isActive: true }, select: { id: true } });
          userIds.push(...staff.map((u) => u.id));
        }
        if (announcement.audience !== "STAFF") {
          // Families: everyone in the school, or just one class's.
          const enrollments = await db.enrollment.findMany({
            where: {
              term: { isCurrent: true },
              ...(announcement.classArmId ? { classArmId: announcement.classArmId } : {}),
            },
            select: { studentId: true },
          });
          const ids = [...new Set(enrollments.map((e) => e.studentId))];
          const links = await db.studentGuardian.findMany({
            where: { studentId: { in: ids } },
            select: { guardianId: true },
          });
          guardianIds.push(...new Set(links.map((l) => l.guardianId)));
          // Students hear about EVERYONE and CLASS, never PARENTS.
          if (announcement.audience !== "PARENTS") studentIds.push(...ids);
        }

        return { schoolName: school.name, urgent: announcement.urgent, guardianIds, studentIds, userIds };
      });
      if (!audience) return;

      const common = {
        schoolId: args.schoolId,
        eventType: EVENT.announcementPosted,
        eventId: args.announcementId,
        title: audience.schoolName,
        body: "New announcement from your school.",
        data: { screen: "announcements" },
        urgent: audience.urgent,
      };
      for (const guardianId of audience.guardianIds) {
        await this.dispatch.notifyOfEvent({ ...common, principal: { type: "GUARDIAN", guardianId } });
      }
      for (const studentId of audience.studentIds) {
        await this.dispatch.notifyOfEvent({ ...common, principal: { type: "STUDENT", studentId } });
      }
      for (const userId of audience.userIds) {
        await this.dispatch.notifyOfEvent({ ...common, principal: { type: "STAFF", userId } });
      }
    });
  }

  /** N7: the event already happened; telling people about it may fail. */
  private async safely(what: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      this.logger.error(`Notifying about ${what} failed; the event itself stands. ${String(err)}`);
    }
  }
}
