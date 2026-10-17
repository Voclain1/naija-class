import { Injectable, Logger } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import { ADMISSION_LIMITS } from "@school-kit/types";

import { EmailService } from "../../common/email/email.service.js";
import { redactPhone } from "../../common/redact.js";
import { smsSenderFor } from "../../common/termii/sms-sender.js";
import { normalizeNigerianPhone, TermiiService } from "../../common/termii/termii.service.js";
import { NotificationDispatchService } from "../notifications/notification-dispatch.service.js";
import { ADMISSION_ROLES, escapeHtml, lagosToday, loadAdmissionSettings } from "./admissions.shared.js";

// Phase 9 / CP7.1 — telling the school of every new application (owner,
// §16.8): the owner, admins and Admissions officers by PUSH on the staff app,
// EMAIL, and SMS; and the school's own copy-to address by email.
//
// SMS costs money per message, so a school can switch it off, and alerts stop
// at 30 SMS a school a Lagos day: the counter is one conditional upsert, so
// two applications arriving together cannot both take the last place. The
// 30th says so; email and push carry on. Telling is best-effort: a failure
// is logged and never fails the application, which is already saved.

export const ADMISSION_EVENT = "admission.applied";

function webBaseUrl(): string {
  return process.env.WEB_BASE_URL ?? "http://localhost:3001";
}

@Injectable()
export class AdmissionAlertsService {
  private readonly logger = new Logger(AdmissionAlertsService.name);

  constructor(
    private readonly dispatch: NotificationDispatchService,
    private readonly email: EmailService,
    private readonly termii: TermiiService,
  ) {}

  async newApplication(schoolId: string, applicationId: string): Promise<void> {
    try {
      await this.tell(schoolId, applicationId);
    } catch (err) {
      this.logger.error(`Telling the school of a new application failed; the application stands. ${String(err)}`);
    }
  }

  private async tell(schoolId: string, applicationId: string): Promise<void> {
    const ctx = await withTenant(schoolId, async (db) => {
      const app = await db.admissionApplication.findUnique({
        where: { id: applicationId },
        select: { reference: true, childFirstName: true, childLastName: true, classLevel: { select: { name: true } } },
      });
      const school = await db.school.findUnique({ where: { id: schoolId }, select: { name: true, smsSenderId: true, smsSenderStatus: true } });
      const settings = await loadAdmissionSettings(db, schoolId);
      const staff = await db.user.findMany({
        where: { schoolId, isActive: true, roles: { some: { role: { key: { in: [...ADMISSION_ROLES] } } } } },
        select: { id: true, email: true, phone: true },
      });
      return { app, school, settings, staff };
    });
    if (!ctx.app || !ctx.school) return;
    const { app, school, settings, staff } = ctx;
    const link = `${webBaseUrl()}/admissions/${applicationId}`;

    // Push: lockscreen-safe, no name (N3).
    for (const user of staff) {
      await this.dispatch.notifyOfEvent({
        schoolId,
        principal: { type: "STAFF", userId: user.id },
        eventType: ADMISSION_EVENT,
        eventId: applicationId,
        title: school.name,
        body: `New admission application for ${app.classLevel.name}.`,
        data: { screen: "admissions" },
      });
    }

    // Email: to the staff who handle applications, and the school's copy-to address.
    if (this.email.isConfigured) {
      const childName = escapeHtml(`${app.childFirstName} ${app.childLastName}`);
      const html =
        `<p>A new admission application has arrived.</p>` +
        `<p><strong>${childName}</strong>, for ${escapeHtml(app.classLevel.name)}. Reference ${app.reference}.</p>` +
        `<p><a href="${link}">Open it in SchoolKit</a></p>`;
      const to = new Set([...staff.map((u) => u.email).filter((e): e is string => !!e), ...(settings.notifyEmail ? [settings.notifyEmail] : [])]);
      for (const address of to) {
        try {
          await this.email.send({ to: address, subject: `New admission application ${app.reference}`, html, purpose: "admission-alert", schoolName: school.name });
        } catch (err) {
          this.logger.warn(`Admission alert email failed: ${String(err)}`);
        }
      }
    }

    // SMS: switchable, and capped per day.
    if (!settings.smsAlerts || !this.termii.isConfigured) return;
    const sender = smsSenderFor(school);
    for (const user of staff) {
      const phone = user.phone ? normalizeNigerianPhone(user.phone) : null;
      if (!phone) continue;
      const sent = await this.takeSmsPlace(schoolId);
      if (sent === null) return; // today's 30 are used; email and push still went
      const last = sent === ADMISSION_LIMITS.smsPerDay ? " SMS alerts have reached today's limit; the rest come by email and in the app." : "";
      try {
        await this.termii.sendSms(phone, `${school.name}: new admission application ${app.reference} for ${app.classLevel.name}. Open SchoolKit to review.${last}`, sender);
      } catch (err) {
        this.logger.warn(`Admission alert SMS to ${redactPhone(user.phone)} failed: ${String(err)}`);
      }
    }
  }

  /** Takes one of today's SMS places; null when all are used. */
  private async takeSmsPlace(schoolId: string): Promise<number | null> {
    const day = lagosToday();
    const rows = await withTenant(schoolId, (db) =>
      db.$queryRaw<{ sent: number }[]>(Prisma.sql`
        INSERT INTO admission_sms_counters (school_id, day, sent) VALUES (${schoolId}, ${day}::date, 1)
        ON CONFLICT (school_id, day) DO UPDATE SET sent = admission_sms_counters.sent + 1
        WHERE admission_sms_counters.sent < ${ADMISSION_LIMITS.smsPerDay}
        RETURNING sent`),
    );
    return rows[0]?.sent ?? null;
  }
}
