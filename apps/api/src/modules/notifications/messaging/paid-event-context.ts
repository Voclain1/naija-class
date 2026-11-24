import { type NotificationDelivery, withTenant } from "@school-kit/db";
import { formatKobo } from "@school-kit/types";

import { isPaystackPaymentRequestCode, PAYSTACK_PAYMENT_REQUEST_BASE } from "../../../common/paystack/payment-request-code";
import { parentSiteUrl } from "../../../common/school-site-url";
import { smsSenderFor } from "../../../common/termii/sms-sender";

export const PAID_PAYMENT_EVENT = "payment.confirmation-paid";
export const PAID_EVENTS = {
  [PAID_PAYMENT_EVENT]: "fee_payment_confirmation",
  "messaging.invoice-issued": "fee_invoice_issued",
  "messaging.fee-reminder": "fee_payment_reminder",
  "messaging.fee-overdue": "fee_payment_overdue",
  "messaging.absence": "student_absence_alert",
  "messaging.results-released": "results_released",
  "messaging.exam-published": "examination_notification",
  "messaging.guardian-invitation": "guardian_invitation",
} as const;

export type PaidEvent = keyof typeof PAID_EVENTS;
export type OtherPaidEvent = Exclude<PaidEvent, typeof PAID_PAYMENT_EVENT>;

const openStatuses = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] as const;

export type DispatchFacts = {
  fields: Record<string, string>;
  sms: string;
  senderId?: string;
  paymentCode?: string;
  campaign?: { id: string; approvedUnitKobo: number | null };
};

export async function readPaidEventFacts(job: NotificationDelivery, now: Date): Promise<DispatchFacts | "WAIT_LINK" | null> {
  const { schoolId, principalId, eventId } = job;
  return withTenant(schoolId, async (db): Promise<DispatchFacts | "WAIT_LINK" | null> => {
    const school = await db.school.findFirst({
      where: { id: schoolId, status: "ACTIVE", suspendedAt: null, deletionStartedAt: null },
      select: { name: true, slug: true, smsSenderId: true, smsSenderStatus: true, paystackPaymentsEnabled: true, paystackSplitCode: true },
    });
    if (!school) return null;
    if (job.eventType === "messaging.guardian-invitation") {
      const invitation = await db.guardianInvitation.findFirst({
        where: { schoolId, guardianId: principalId, id: eventId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now },
          guardian: { portalDisabledAt: null } },
        select: { id: true },
      });
      return invitation ? { fields: { schoolName: school.name, parentPortalUrl: parentSiteUrl(school.slug, "/login") }, sms: "" } : null;
    }
    const links = await db.studentGuardian.findMany({
      where: { schoolId, guardianId: principalId, guardian: { portalDisabledAt: null } },
      select: { studentId: true, student: { select: { firstName: true, lastName: true } } },
    });
    if (!links.length) return null;
    const studentIds = links.map(({ studentId }) => studentId);
    const fields: Record<string, string> = { schoolName: school.name };

    if (job.eventType === "messaging.absence") {
      const today = new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);
      if (eventId !== today) return null;
      const marked = await db.attendanceRecord.findFirst({
        where: { schoolId, studentId: { in: studentIds }, status: "ABSENT", date: new Date(today) },
        select: { id: true },
      });
      if (!marked) return null;
      fields.absenceDate = today;
      return { fields, sms: "" };
    }

    if (job.eventType === "messaging.results-released") {
      const [termId, classArmId] = eventId.split(":");
      if (!termId || !classArmId) return null;
      const card = await db.reportCard.findFirst({
        where: { schoolId, termId, classArmId, studentId: { in: studentIds }, status: "RELEASED", accessMode: "FREE" },
        select: { id: true },
      });
      const term = await db.term.findFirst({ where: { schoolId, id: termId }, select: { name: true } });
      if (!card || !term) return null;
      fields.termName = term.name;
      return { fields, sms: "" };
    }

    if (job.eventType === "messaging.exam-published") {
      const exam = await db.cbtSitting.findFirst({
        where: { schoolId, id: eventId, status: "PUBLISHED", startsAt: { gt: now }, candidates: { some: { studentId: { in: studentIds } } } },
        select: { title: true, startsAt: true },
      });
      if (!exam) return null;
      fields.examTitle = exam.title;
      fields.examStart = exam.startsAt.toLocaleString("en-NG", {
        timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short",
      });
      return { fields, sms: "" };
    }

    if (["messaging.invoice-issued", "messaging.fee-reminder", "messaging.fee-overdue"].includes(job.eventType)) {
      const reminder = job.eventType !== "messaging.invoice-issued";
      const [invoiceId, sendId] = eventId.split(":");
      if (!invoiceId) return null;
      let campaign: DispatchFacts["campaign"];
      if (reminder) {
        if (!sendId) return null;
        const send = await db.reminderCampaignSend.findFirst({
          where: { id: sendId, schoolId, invoiceId, guardianId: principalId, status: { in: ["SENDING", "ACCEPTED"] },
            campaign: { schoolId, useWhatsApp: true, status: { in: ["RUNNING", "COMPLETED"] } },
          },
          select: { studentId: true, campaign: { select: { id: true, approvedWhatsAppUnitKobo: true } } },
        });
        if (!send || !studentIds.includes(send.studentId)) return null;
        const invoiceMatch = await db.invoice.count({ where: { id: invoiceId, schoolId, studentId: send.studentId } });
        if (invoiceMatch !== 1) return null;
        campaign = { id: send.campaign.id, approvedUnitKobo: send.campaign.approvedWhatsAppUnitKobo };
      }
      const invoice = await db.invoice.findFirst({
        where: { schoolId, id: invoiceId, studentId: { in: studentIds },
          status: { in: job.eventType === "messaging.fee-overdue" ? ["OVERDUE"] : [...openStatuses] }, issuedAt: { not: null } },
        select: { studentId: true, totalDue: true, totalPaid: true, dueDate: true },
      });
      if (!invoice || invoice.totalDue <= invoice.totalPaid || !school.paystackPaymentsEnabled || !school.paystackSplitCode) return null;
      if (await db.paymentPlan.count({ where: { schoolId, invoiceId } })) return null;
      const outstanding = invoice.totalDue - invoice.totalPaid;
      const link = await db.paymentLink.findFirst({
        where: { schoolId, invoiceId, status: "LIVE", archivedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], currency: "NGN", amount: outstanding },
        select: { requestCode: true, hostedUrl: true },
      });
      if (!isPaystackPaymentRequestCode(link?.requestCode) || link.hostedUrl !== `${PAYSTACK_PAYMENT_REQUEST_BASE}${link.requestCode}`) return reminder ? null : "WAIT_LINK";
      const student = links.find(({ studentId }) => studentId === invoice.studentId)?.student;
      fields.balanceLeft = formatKobo(outstanding);
      if (student) fields.studentName = `${student.firstName} ${student.lastName}`;
      if (invoice.dueDate) fields.dueDate = invoice.dueDate.toISOString().slice(0, 10);
      return { fields, sms: "", paymentCode: link.requestCode, campaign };
    }

    if (job.eventType !== PAID_PAYMENT_EVENT) return null;
    const payment = await db.payment.findFirst({
      where: { schoolId, id: eventId, status: "SUCCESS", method: "PAYSTACK", paidAt: { not: null }, studentId: { in: studentIds } },
      select: { studentId: true, invoiceId: true, amount: true },
    });
    if (!payment) return null;
    const student = links.find(({ studentId }) => studentId === payment.studentId)?.student;
    const invoice = await db.invoice.findFirst({
      where: { schoolId, id: payment.invoiceId }, select: { totalDue: true, totalPaid: true },
    });
    if (!invoice || !student) return null;
    fields.studentName = `${student.firstName} ${student.lastName}`;
    fields.amountPaid = formatKobo(payment.amount);
    fields.balanceLeft = formatKobo(Math.max(0, invoice.totalDue - invoice.totalPaid));
    return { fields, sms: `${school.name}: We received a school fees payment of ${fields.amountPaid}. Check your parent portal.`, senderId: smsSenderFor(school) };
  });
}
