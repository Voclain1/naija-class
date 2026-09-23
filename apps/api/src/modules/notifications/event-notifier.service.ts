import { Injectable, Logger } from "@nestjs/common";

import { withTenant } from "@school-kit/db";

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
} as const;

@Injectable()
export class EventNotifierService {
  private readonly logger = new Logger(EventNotifierService.name);

  constructor(private readonly dispatch: NotificationDispatchService) {}

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

  /** N7: the event already happened; telling people about it may fail. */
  private async safely(what: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      this.logger.error(`Notifying about ${what} failed; the event itself stands. ${String(err)}`);
    }
  }
}
