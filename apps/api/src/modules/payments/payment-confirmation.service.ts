import { Injectable, Logger, Optional } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import { formatKobo } from "@school-kit/types";

import { EmailService } from "../../common/email/email.service.js";
import { isSuppressedForAll } from "../announcements/announcement-email.shared.js";
import { escapeHtml } from "../admissions/admissions.shared.js";
import { EventNotifierService } from "../notifications/event-notifier.service.js";

// The family's confirmation of an ONLINE payment, in the school's name
// (2026-10-21).
//
// Every school's payment runs through SchoolKit's one Paystack integration,
// so Paystack's own receipt email says "payment to SchoolKit". The owner
// switches those emails off in the Paystack dashboard and this one replaces
// them: from "<school> via SchoolKit", naming the child, the amount and what
// is left to pay. It confirms the money arrived; the school still issues the
// receipt, as it does for cash.
//
// Sent once per guardian per payment, however many of the three success paths
// (webhook, the portal's verify poll, a payment link) see the payment: the
// notification_deliveries row is claimed before the send, so two racing
// callers produce one email, and a crash after the claim is a missed email
// rather than a duplicate — the push rail's rule (N7).
//
// Fire and forget: called after the payment's transaction has committed, and
// it never throws. A payment must not fail because Resend is slow.

export const PAYMENT_CONFIRMATION_EMAIL_EVENT = "payment.confirmation-email";

@Injectable()
export class PaymentConfirmationService {
  private readonly logger = new Logger(PaymentConfirmationService.name);

  constructor(
    @Optional() private readonly email?: EmailService,
    @Optional() private readonly events?: EventNotifierService,
  ) {}

  async onlinePaymentSucceeded(schoolId: string, paymentId: string): Promise<void> {
    // The app's "payment recorded" push, which cash payments already send.
    await this.events?.paymentRecorded({ schoolId, paymentId });
    try {
      await this.sendEmails(schoolId, paymentId);
    } catch (err) {
      this.logger.error(`Payment confirmation email for ${paymentId} failed; the payment stands. ${String(err)}`);
    }
  }

  private async sendEmails(schoolId: string, paymentId: string): Promise<void> {
    if (!this.email?.isConfigured) return;
    const ctx = await withTenant(schoolId, async (db) => {
      const payment = await db.payment.findUnique({
        where: { id: paymentId },
        select: {
          schoolId: true,
          invoiceId: true,
          studentId: true,
          amount: true,
          method: true,
          status: true,
          paidAt: true,
          paystackReference: true,
        },
      });
      if (!payment || payment.schoolId !== schoolId) return null;
      if (payment.status !== "SUCCESS" || payment.method !== "PAYSTACK") return null;
      const invoice = await db.invoice.findUniqueOrThrow({
        where: { id: payment.invoiceId },
        select: { termId: true, totalDue: true, totalPaid: true },
      });
      const term = await db.term.findUnique({ where: { id: invoice.termId }, select: { name: true } });
      const student = await db.student.findUniqueOrThrow({
        where: { id: payment.studentId },
        select: { firstName: true, lastName: true },
      });
      const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true } });
      const links = await db.studentGuardian.findMany({
        where: { studentId: payment.studentId },
        select: { guardian: { select: { id: true, firstName: true, email: true } } },
      });
      const recipients: { guardianId: string; firstName: string; email: string }[] = [];
      for (const { guardian } of links) {
        if (!guardian.email || recipients.some((r) => r.guardianId === guardian.id)) continue;
        if (await isSuppressedForAll(db, schoolId, guardian.email)) continue;
        recipients.push({ guardianId: guardian.id, firstName: guardian.firstName, email: guardian.email });
      }
      return { payment, invoice, termName: term?.name ?? null, student, schoolName: school.name, recipients };
    });
    if (!ctx) return;

    const studentName = `${ctx.student.firstName} ${ctx.student.lastName}`;
    for (const recipient of ctx.recipients) {
      const claimed = await withTenant(schoolId, async (db) => {
        try {
          await db.notificationDelivery.create({
            data: {
              schoolId,
              eventType: PAYMENT_CONFIRMATION_EMAIL_EVENT,
              eventId: paymentId,
              principalType: "GUARDIAN",
              principalId: recipient.guardianId,
              channel: "EMAIL",
            },
          });
          return true;
        } catch {
          return false; // already told
        }
      });
      if (!claimed) continue;
      try {
        await this.email.send({
          to: recipient.email,
          purpose: "payment-confirmation",
          schoolName: ctx.schoolName,
          subject: `Payment received: ${studentName}'s school fees`,
          html: buildPaymentConfirmationHtml({
            schoolName: ctx.schoolName,
            guardianFirstName: recipient.firstName,
            studentName,
            termName: ctx.termName,
            amount: ctx.payment.amount,
            balance: Math.max(0, ctx.invoice.totalDue - ctx.invoice.totalPaid),
            paidAt: ctx.payment.paidAt ?? new Date(),
            reference: ctx.payment.paystackReference,
          }),
        });
      } catch (err) {
        this.logger.warn(`Payment confirmation email for ${paymentId} not sent: ${String(err)}`);
      }
    }
  }
}

export function buildPaymentConfirmationHtml(opts: {
  schoolName: string;
  guardianFirstName: string;
  studentName: string;
  termName: string | null;
  amount: number;
  balance: number;
  paidAt: Date;
  reference: string | null;
}): string {
  const e = escapeHtml;
  const cell = "padding:8px;border:1px solid #e5e7eb";
  const row = (label: string, value: string) =>
    `<tr><td style="${cell}">${label}</td><td style="${cell};font-weight:600">${value}</td></tr>`;
  const date = opts.paidAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Payment received</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#1a1a1a">${e(opts.schoolName)}</h2>
  <p>Dear ${e(opts.guardianFirstName)},</p>
  <p>${e(opts.schoolName)} has received your online payment for <strong>${e(opts.studentName)}</strong>'s school fees.</p>
  <table style="border-collapse:collapse;width:100%">
    ${row("Amount paid", e(formatKobo(opts.amount)))}
    ${opts.termName ? row("For", e(opts.termName)) : ""}
    ${row("Date", e(date))}
    ${opts.reference ? row("Payment reference", e(opts.reference)) : ""}
    ${row("Balance left", opts.balance > 0 ? e(formatKobo(opts.balance)) : "Nothing. This bill is fully paid.")}
  </table>
  <p>${e(opts.schoolName)} will issue your receipt.</p>
  <p style="color:#6b7280;font-size:13px">Online payments are processed by Paystack for SchoolKit, which ${e(opts.schoolName)} uses for school fees. Your bank statement may show SchoolKit.</p>
</body>
</html>`;
}
