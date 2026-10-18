import { Injectable, Logger } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import { MESSAGE_LIMITS } from "@school-kit/types";

import { EmailService } from "../../common/email/email.service.js";
import { portalBaseUrl } from "../../common/portal-url.js";
import { redactPhone } from "../../common/redact.js";
import { smsSenderFor } from "../../common/termii/sms-sender.js";
import { normalizeNigerianPhone, TermiiService } from "../../common/termii/termii.service.js";
import { NotificationDispatchService } from "../notifications/notification-dispatch.service.js";
import { NotificationPreferencesService } from "../notifications/notification-preferences.service.js";
import { lagosToday, recipientsOf } from "./messages.shared.js";

// Phase 9 / CP8.1 — telling people of a new message (docs/modules/phase-9.md
// §17.2 CP8-D6, §17.8 answer 6). Never the text, and never a child's name on
// a lock screen.
//
//   A parent's message → push to that conversation's recipients ONLY.
//   The school's message → the parent by push; if the parent has no app,
//   email (when the school's email channel is on); else SMS, only when the
//   school's SMS channel is on, at most 50 a school a Lagos day (one
//   conditional upsert, as admissions does).
//
// Best-effort: a failure is logged and never fails the message, which is
// already saved.

export const MESSAGE_TO_STAFF_EVENT = "message.received";
export const MESSAGE_TO_GUARDIAN_EVENT = "message.reply";

@Injectable()
export class MessageAlertsService {
  private readonly logger = new Logger(MessageAlertsService.name);

  constructor(
    private readonly dispatch: NotificationDispatchService,
    private readonly preferences: NotificationPreferencesService,
    private readonly email: EmailService,
    private readonly termii: TermiiService,
  ) {}

  /** A parent wrote: push to everyone who may see the conversation. */
  async toStaff(schoolId: string, threadId: string, messageId: string): Promise<void> {
    try {
      const found = await withTenant(schoolId, async (db) => {
        const thread = await db.messageThread.findUnique({
          where: { id: threadId },
          select: { recipient: true, recipientUserId: true, passes: { select: { recipient: true, recipientUserId: true, passedByUserId: true } } },
        });
        const school = await db.school.findUnique({ where: { id: schoolId }, select: { name: true } });
        return { users: thread ? await recipientsOf(db, schoolId, thread) : [], school };
      });
      for (const userId of found.users) {
        await this.dispatch.notifyOfEvent({
          schoolId,
          principal: { type: "STAFF", userId },
          eventType: MESSAGE_TO_STAFF_EVENT,
          eventId: messageId,
          title: found.school?.name ?? "SchoolKit",
          body: "New message from a parent.",
          data: { screen: "messages", threadId },
        });
      }
    } catch (err) {
      this.logger.error(`Telling staff of a message failed; the message stands. ${String(err)}`);
    }
  }

  /** The school wrote: tell the parent by push, else email, else capped SMS. */
  async toGuardian(schoolId: string, threadId: string, messageId: string): Promise<"PUSH" | "EMAIL" | "SMS" | "NONE"> {
    try {
      const ctx = await withTenant(schoolId, async (db) => {
        const thread = await db.messageThread.findUnique({
          where: { id: threadId },
          select: { guardian: { select: { id: true, email: true, phone: true } } },
        });
        const school = await db.school.findUnique({ where: { id: schoolId }, select: { name: true, smsSenderId: true, smsSenderStatus: true } });
        return { guardian: thread?.guardian ?? null, school };
      });
      if (!ctx.guardian || !ctx.school) return "NONE";
      const { guardian, school } = ctx;

      const pushed = await this.dispatch.notifyOfEvent({
        schoolId,
        principal: { type: "GUARDIAN", guardianId: guardian.id },
        eventType: MESSAGE_TO_GUARDIAN_EVENT,
        eventId: messageId,
        title: school.name,
        body: "You have a new message from the school.",
        data: { screen: "messages", threadId },
      });
      if (pushed === "PUSH") return "PUSH";

      const channels = await this.preferences.getEnabledChannels(schoolId);
      const link = `${portalBaseUrl()}/messages/${threadId}`;
      if (channels.email && guardian.email && this.email.isConfigured) {
        try {
          await this.email.send({
            to: guardian.email,
            purpose: "message-reply",
            schoolName: school.name,
            subject: `${school.name} replied to your message`,
            html: `<p>${escape(school.name)} has replied to your message.</p><p><a href="${link}">Open the parent portal to read it</a>.</p>`,
          });
          return "EMAIL";
        } catch (err) {
          this.logger.warn(`Message reply email failed: ${String(err)}`);
        }
      }

      const phone = normalizeNigerianPhone(guardian.phone);
      if (!channels.sms || !this.termii.isConfigured || !phone) return "NONE";
      if ((await this.takeSmsPlace(schoolId)) === null) return "NONE";
      try {
        await this.termii.sendSms(phone, `${school.name} replied to your message. Open the parent portal to read it: ${link}`, smsSenderFor(school));
        return "SMS";
      } catch (err) {
        this.logger.warn(`Message reply SMS to ${redactPhone(guardian.phone)} failed: ${String(err)}`);
        return "NONE";
      }
    } catch (err) {
      this.logger.error(`Telling a parent of a reply failed; the message stands. ${String(err)}`);
      return "NONE";
    }
  }

  /** Takes one of today's SMS places; null when all are used. */
  private async takeSmsPlace(schoolId: string): Promise<number | null> {
    const day = lagosToday();
    const rows = await withTenant(schoolId, (db) =>
      db.$queryRaw<{ sent: number }[]>(Prisma.sql`
        INSERT INTO message_sms_counters (school_id, day, sent) VALUES (${schoolId}, ${day}::date, 1)
        ON CONFLICT (school_id, day) DO UPDATE SET sent = message_sms_counters.sent + 1
        WHERE message_sms_counters.sent < ${MESSAGE_LIMITS.smsPerDay}
        RETURNING sent`),
    );
    return rows[0]?.sent ?? null;
  }
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
