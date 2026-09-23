import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { basePrisma } from "@school-kit/db";

import { EventNotifierService } from "./event-notifier.service";

// The two teacher reminders (docs/modules/notifications-v1.md N1, part 2).
//
// Both are about a deadline someone ELSE depends on, which is the test a
// notification has to pass: a teacher can see their own outstanding work by
// opening the app, but the head cannot see it until report time, and by then
// it is expensive.
//
// WHAT "DUE" MEANS, HONESTLY. The schema carries no per-assessment deadline,
// so "your marks are due today" would be an invented rule about someone's
// work. What it does carry is the TERM'S END DATE, and marks are what the
// term ends with. So the marks reminder is "the term ends in a week and you
// have subjects with nothing entered" — a real deadline, derived from real
// data, and said as what it is.
//
// Both sweeps follow the shape FinanceService.transitionOverdueInvoices and
// OnboardingNudgeService already use: a @Cron that walks ACTIVE schools, each
// one inside its own tenant transaction, and never lets one school's failure
// stop the next.

/** How many days before a term ends a teacher hears about unentered marks. */
export const MARKS_REMINDER_DAYS_BEFORE_TERM_END = 7;

@Injectable()
export class TeacherRemindersService {
  private readonly logger = new Logger(TeacherRemindersService.name);

  constructor(private readonly events: EventNotifierService) {}

  // 09:00 UTC = 10:00 Lagos, weekdays. Mid-morning on purpose: early enough
  // that the register can still be taken during the school day, late enough
  // that a teacher is not chased over a lesson that has not happened.
  // schoolIds is an optional allow-list used by tests to scope the sweep to
  // one fixture school, the same convention as
  // FinanceService.transitionOverdueInvoices and OnboardingNudgeService. The
  // production @Cron call passes nothing → every ACTIVE school is swept.
  @Cron("0 9 * * 1-5")
  async remindAboutRegisters(schoolIds?: string[], today?: string): Promise<void> {
    await this.forEachActiveSchool("registers", schoolIds, today, (schoolId, date) =>
      this.events.registersNotTaken({ schoolId, date }),
    );
  }

  // 08:00 UTC = 09:00 Lagos, daily. The service itself decides whether today
  // is the day (a week before the term ends), so the cron stays dumb.
  @Cron("0 8 * * *")
  async remindAboutMarks(schoolIds?: string[], today?: string): Promise<void> {
    await this.forEachActiveSchool("marks", schoolIds, today, (schoolId, day) =>
      this.events.marksNotEntered({ schoolId, today: day, daysBefore: MARKS_REMINDER_DAYS_BEFORE_TERM_END }),
    );
  }

  /**
   * Walk every active school, one at a time, and never let one school's
   * failure stop the sweep — the next school's teachers should still be told.
   *
   * `basePrisma` for the roster only: schools is the tenant table every other
   * policy keys off, and each school's own work happens under withTenant.
   */
  private async forEachActiveSchool(
    what: string,
    schoolIds: string[] | undefined,
    todayOverride: string | undefined,
    run: (schoolId: string, today: string) => Promise<void>,
  ): Promise<void> {
    const schools = await basePrisma.school.findMany({
      where: { status: "ACTIVE", ...(schoolIds?.length ? { id: { in: schoolIds } } : {}) },
      select: { id: true },
    });
    // The school's day, in the school's zone — not the server's. Nigeria is
    // UTC+1 all year, so the hour offset is a constant, not a lookup.
    const today = todayOverride ?? new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
    for (const school of schools) {
      try {
        await run(school.id, today);
      } catch (err) {
        this.logger.error(`Teacher ${what} reminder failed for school ${school.id}: ${String(err)}`);
      }
    }
  }
}
