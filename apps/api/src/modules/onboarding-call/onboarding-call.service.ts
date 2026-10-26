import { Injectable, Logger } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  NotFoundError,
  ValidationError,
  formatCallSlot,
  onboardingCallDays,
  onboardingCallStarts,
  type BookOnboardingCallInput,
  type OnboardingCallBookingDto,
  type OnboardingCallStateDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf, getActiveUserRoleKeys } from "../../common/auth/role-check.js";
import { EmailService } from "../../common/email/email.service.js";
import { sendWhatsappAlert } from "../../common/whatsapp/whatsapp-cloud.js";
import { escapeHtml } from "../admissions/admissions.shared.js";

// Setup calls (docs/modules/onboarding-call.md). After the setup wizard the
// owner sees a page offering a call with the SchoolKit team, once: booking or
// skipping closes it for good. A booking is saved under the school's RLS,
// emailed to the team, sent to the team's WhatsApp when that is configured,
// and listed in the platform admin.

export const ONBOARDING_CALL_AUDIT = {
  booked: "onboarding_call.booked",
  skipped: "onboarding_call.skipped",
  done: "onboarding_call.done",
} as const;

export const BOOKING_SELECT = {
  id: true,
  callDate: true,
  startMinute: true,
  contactName: true,
  contactPhone: true,
  note: true,
  createdAt: true,
  doneAt: true,
} as const;

interface BookingRow {
  id: string;
  callDate: Date;
  startMinute: number;
  contactName: string;
  contactPhone: string;
  note: string | null;
  createdAt: Date;
  doneAt: Date | null;
}

export function toDto(row: BookingRow): OnboardingCallBookingDto {
  return {
    id: row.id,
    date: row.callDate.toISOString().slice(0, 10),
    startMinute: row.startMinute,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

export function alertEmailTo(): string {
  return process.env.ONBOARDING_CALL_ALERT_EMAIL || "hello@schoolkit.ng";
}

export function buildBookingEmailHtml(opts: { schoolName: string; schoolSlug: string; booking: OnboardingCallBookingDto }): string {
  const b = opts.booking;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 16px 6px 0;color:#5B6B70">${label}</td><td style="padding:6px 0;font-weight:600">${escapeHtml(value)}</td></tr>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>New setup call</title></head>
<body style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#13262E">
  <h2 style="margin:0 0 16px">New setup call booked</h2>
  <table style="border-collapse:collapse">
    ${row("School", `${opts.schoolName} (${opts.schoolSlug})`)}
    ${row("When", `${formatCallSlot(b.date, b.startMinute)}, Lagos time`)}
    ${row("Name", b.contactName)}
    ${row("Phone", b.contactPhone)}
    ${b.note ? row("Note", b.note) : ""}
  </table>
  <p style="margin-top:20px;color:#5B6B70;font-size:13px">Confirm the time with them on WhatsApp, then mark the call done in the platform admin under Setup calls.</p>
</body></html>`;
}

@Injectable()
export class OnboardingCallService {
  private readonly logger = new Logger(OnboardingCallService.name);

  constructor(private readonly email: EmailService) {}

  async state(ctx: AuthContext): Promise<OnboardingCallStateDto> {
    const roleKeys = await getActiveUserRoleKeys(ctx);
    return withTenant(ctx.schoolId, async (db) => {
      const [school, user, booking] = await Promise.all([
        db.school.findUnique({ where: { id: ctx.schoolId }, select: { status: true, onboardingCallPromptClosedAt: true } }),
        db.user.findUnique({ where: { id: ctx.userId }, select: { firstName: true, lastName: true, phone: true } }),
        db.onboardingCallBooking.findFirst({ orderBy: { createdAt: "desc" }, select: BOOKING_SELECT }),
      ]);
      if (!school) throw new NotFoundError("School not found.");
      return {
        show: roleKeys.includes("owner") && school.status === "ACTIVE" && school.onboardingCallPromptClosedAt === null,
        booking: booking ? toDto(booking) : null,
        suggestedName: user ? `${user.firstName} ${user.lastName}`.trim() : "",
        suggestedPhone: user?.phone ?? "",
      };
    });
  }

  async book(ctx: AuthContext, input: BookOnboardingCallInput, ipAddress: string | null, now: Date = new Date()): Promise<OnboardingCallBookingDto> {
    await assertUserActiveAndHasOneOf(ctx, ["owner", "admin"]);
    if (!onboardingCallDays(now).includes(input.date)) {
      throw new ValidationError("ONBOARDING_CALL_DAY", "Choose a day from the calendar.");
    }
    if (!onboardingCallStarts().includes(input.startMinute)) {
      throw new ValidationError("ONBOARDING_CALL_TIME", "Choose one of the times shown.");
    }

    const { booking, school } = await withTenant(ctx.schoolId, async (db) => {
      const created = await db.onboardingCallBooking.create({
        data: {
          schoolId: ctx.schoolId,
          bookedBy: ctx.userId,
          callDate: new Date(`${input.date}T00:00:00Z`),
          startMinute: input.startMinute,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          note: input.note?.trim() || null,
        },
        select: BOOKING_SELECT,
      });
      const school = await db.school.update({
        where: { id: ctx.schoolId },
        data: { onboardingCallPromptClosedAt: now, onboardingCallBookedAt: now },
        select: { name: true, slug: true },
      });
      // The audit row carries the slot, never the phone number.
      await db.auditLog.create({
        data: {
          schoolId: ctx.schoolId,
          userId: ctx.userId,
          action: ONBOARDING_CALL_AUDIT.booked,
          entityType: "onboarding_call_booking",
          entityId: created.id,
          ipAddress,
          metadata: { date: input.date, startMinute: input.startMinute },
        },
      });
      return { booking: toDto(created), school };
    });

    await this.notify(school, booking);
    return booking;
  }

  async skip(ctx: AuthContext, ipAddress: string | null): Promise<void> {
    await assertUserActiveAndHasOneOf(ctx, ["owner", "admin"]);
    await withTenant(ctx.schoolId, async (db) => {
      const updated = await db.school.updateMany({
        where: { id: ctx.schoolId, onboardingCallPromptClosedAt: null },
        data: { onboardingCallPromptClosedAt: new Date() },
      });
      if (updated.count === 0) return;
      await db.auditLog.create({
        data: { schoolId: ctx.schoolId, userId: ctx.userId, action: ONBOARDING_CALL_AUDIT.skipped, entityType: "school", entityId: ctx.schoolId, ipAddress },
      });
    });
  }

  // Email first, WhatsApp second; neither may fail the booking, which is saved
  // and listed in the platform admin whatever happens here.
  private async notify(school: { name: string; slug: string }, booking: OnboardingCallBookingDto): Promise<void> {
    try {
      await this.email.send({
        to: alertEmailTo(),
        subject: `Setup call: ${school.name}, ${formatCallSlot(booking.date, booking.startMinute)}`,
        html: buildBookingEmailHtml({ schoolName: school.name, schoolSlug: school.slug, booking }),
        purpose: "onboarding-call-booked",
      });
    } catch (err) {
      this.logger.warn(`Setup call email failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await sendWhatsappAlert(process.env, {
      template: process.env.WHATSAPP_BOOKING_TEMPLATE,
      parameters: [school.name, `${formatCallSlot(booking.date, booking.startMinute)} (Lagos)`, booking.contactName, booking.contactPhone],
      purpose: "onboarding-call-booked",
    });
  }
}
