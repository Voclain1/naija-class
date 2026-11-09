import type { PrismaClient } from "@school-kit/db";
import {
  REMINDER_CAMPAIGN_LIMITS,
  REMINDER_TEMPLATE_VERSION,
  type PrepareReminderCampaignInput,
  type ReminderBatchErrorCode,
  type ReminderBatchWarningCode,
  type ReminderCampaignProposalDto,
  type ReminderCampaignStudentPreview,
  type ReminderChannelState,
  type ReminderEligibility,
  type ReminderProblem,
} from "@school-kit/types";

import { smsSenderFor } from "../../common/termii/sms-sender";
import { fingerprint } from "../../common/workflow/fingerprint";
import { blockedAddresses } from "../announcements/announcement-email.shared";
import { isQuietHour } from "../notifications/quiet-hours";
import type { ReminderSendPort } from "./reminder-send.port";

// The authoritative preview of a fee reminder campaign
// (docs/modules/reminder-campaigns.md). Read-only; computed at prepare and
// again inside the confirm transaction, which writes only on an equal
// fingerprint. The same eligibility rules run again, per student, just before
// that student's sends are claimed.

export const OPEN_INVOICE_STATUSES = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] as const;

export type ReminderInput = Omit<PrepareReminderCampaignInput, "clientRequestId">;

export interface PlannedSlots {
  studentId: string;
  emailGuardianIds: string[];
  mobileGuardianId: string | null;
}

export interface ReminderPreview {
  students: ReminderCampaignStudentPreview[];
  summary: Pick<
    ReminderCampaignProposalDto,
    "termId" | "termLabel" | "templateVersion" | "options" | "channels" | "counts" | "batchErrors" | "batchWarnings"
  >;
  plan: PlannedSlots[];
  previewHash: string;
  canConfirm: boolean;
}

export interface Channels {
  email: boolean;
  sms: boolean;
  push: boolean;
}

/** What may be attempted now: switched on in Settings and set up on the server. */
export async function attemptableChannels(port: ReminderSendPort, schoolId: string): Promise<{ state: Omit<ReminderChannelState, "sms"> & { sms: Omit<ReminderChannelState["sms"], "sender"> }; can: Channels }> {
  const on = await port.enabledChannels(schoolId);
  const state = {
    email: { enabled: on.email, configured: port.emailConfigured() },
    sms: { enabled: on.sms, configured: port.smsConfigured() },
    push: { enabled: on.push },
  };
  return { state, can: { email: on.email && state.email.configured, sms: on.sms && state.sms.configured, push: on.push } };
}

interface StudentFacts {
  balance: number;
  invoiceCount: number;
  earliestDueDate: string | null;
  onPaymentPlan: boolean;
  overdue: boolean;
}

/** Balance, plan and overdue facts for each student, from open invoices only. */
export async function loadDebtFacts(db: PrismaClient, schoolId: string, termId: string, studentIds: string[]): Promise<Map<string, StudentFacts>> {
  const invoices = await db.invoice.findMany({
    where: { schoolId, termId, studentId: { in: studentIds }, status: { in: [...OPEN_INVOICE_STATUSES] } },
    select: { id: true, studentId: true, totalDue: true, totalPaid: true, dueDate: true, status: true },
    orderBy: [{ studentId: "asc" }, { sequence: "asc" }],
  });
  const plans = invoices.length
    ? await db.paymentPlan.findMany({ where: { schoolId, invoiceId: { in: invoices.map((i) => i.id) } }, select: { invoiceId: true } })
    : [];
  const planned = new Set(plans.map((p) => p.invoiceId));
  const out = new Map<string, StudentFacts>();
  for (const inv of invoices) {
    const f = out.get(inv.studentId) ?? { balance: 0, invoiceCount: 0, earliestDueDate: null, onPaymentPlan: false, overdue: false };
    const owed = inv.totalDue - inv.totalPaid;
    if (owed <= 0) continue;
    f.balance += owed;
    f.invoiceCount += 1;
    const due = inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : null;
    if (due && (!f.earliestDueDate || due < f.earliestDueDate)) f.earliestDueDate = due;
    if (planned.has(inv.id)) f.onPaymentPlan = true;
    if (inv.status === "OVERDUE") f.overdue = true;
    out.set(inv.studentId, f);
  }
  return out;
}

/** The debt-side eligibility: the same rule at preview and before each send. */
export function debtEligibility(facts: StudentFacts | undefined, options: ReminderInput["options"]): ReminderEligibility {
  if (!facts || facts.balance <= 0) return "NO_BALANCE";
  if (facts.onPaymentPlan && !options.includePaymentPlans) return "ON_PAYMENT_PLAN";
  if (options.overdueOnly && !facts.overdue) return "NOT_OVERDUE";
  return "ELIGIBLE";
}

export async function computeReminderPreview(
  db: PrismaClient,
  port: ReminderSendPort,
  schoolId: string,
  input: ReminderInput,
  now: Date = new Date(),
): Promise<ReminderPreview> {
  const batchErrors: ReminderProblem<ReminderBatchErrorCode>[] = [];
  const batchWarnings: ReminderProblem<ReminderBatchWarningCode>[] = [];

  const term = await db.term.findFirst({
    where: { id: input.termId, schoolId },
    select: { name: true, academicYear: { select: { label: true } } },
  });
  const termLabel = term ? `${term.academicYear.label} · ${term.name}` : null;
  if (!term) batchErrors.push({ code: "TERM_NOT_FOUND", message: "The chosen term was not found." });

  const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { smsSenderId: true, smsSenderStatus: true } });
  const { state, can } = await attemptableChannels(port, schoolId);
  const channels: ReminderChannelState = { ...state, sms: { ...state.sms, sender: smsSenderFor(school) ? "SCHOOL" : "SCHOOLKIT" } };
  if (!can.email && !can.sms && !can.push) {
    batchErrors.push({ code: "NO_CHANNEL", message: "Email, SMS and app alerts are all off or not set up. Turn one on in Settings → Notifications." });
  }
  if (!can.email) batchWarnings.push({ code: "EMAIL_UNAVAILABLE", message: "No emails will be sent: email is off or not set up." });
  if (!can.sms) batchWarnings.push({ code: "SMS_UNAVAILABLE", message: "No SMS will be sent: SMS is off or not set up." });
  else if (channels.sms.sender === "SCHOOLKIT") {
    batchWarnings.push({ code: "SMS_SENDER_SCHOOLKIT", message: "SMS will show SchoolKit as the sender: your school's sender name is not approved yet." });
  }

  const ids = input.studentIds;
  const students = await db.student.findMany({
    where: { schoolId, id: { in: ids } },
    select: { id: true, firstName: true, lastName: true, admissionNumber: true },
  });
  const byId = new Map(students.map((s) => [s.id, s]));
  const enrolments = await db.enrollment.findMany({
    where: { schoolId, termId: input.termId, studentId: { in: ids } },
    select: { studentId: true, classArm: { select: { name: true, classLevel: { select: { name: true } } } } },
  });
  const classOf = new Map(enrolments.map((e) => [e.studentId, `${e.classArm.classLevel.name} · ${e.classArm.name}`]));
  const debt = await loadDebtFacts(db, schoolId, input.termId, ids);
  const links = await db.studentGuardian.findMany({
    where: { schoolId, studentId: { in: ids } },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }, { guardianId: "asc" }],
    select: { studentId: true, guardian: { select: { id: true, email: true, phone: true } } },
  });
  const guardiansOf = new Map<string, { id: string; email: string | null; phone: string | null }[]>();
  for (const l of links) guardiansOf.set(l.studentId, [...(guardiansOf.get(l.studentId) ?? []), l.guardian]);
  const emails = [...new Set(links.flatMap((l) => (l.guardian.email ? [l.guardian.email.trim().toLowerCase()] : [])))];
  const blocked = can.email ? await blockedAddresses(db, schoolId, emails) : new Map<string, string>();

  const rows: ReminderCampaignStudentPreview[] = [];
  const plan: PlannedSlots[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    const facts = debt.get(id);
    const guardians = guardiansOf.get(id) ?? [];
    const seen = new Set<string>();
    const emailGuardianIds = can.email
      ? guardians.flatMap((g) => {
          const e = g.email?.trim().toLowerCase();
          if (!e || blocked.get(e) === "SUPPRESSED" || seen.has(e)) return [];
          seen.add(e);
          return [g.id];
        })
      : [];
    const lead = guardians.find((g) => g.phone) ?? guardians[0];
    const smsOk = can.sms && !!lead?.phone;
    const mobile: ReminderCampaignStudentPreview["planned"]["mobile"] = !lead
      ? "NONE"
      : can.push && smsOk
        ? "PUSH_OR_SMS"
        : can.push
          ? "PUSH_ONLY"
          : smsOk
            ? "SMS_ONLY"
            : "NONE";
    let eligibility: ReminderEligibility;
    if (!s) eligibility = "NOT_FOUND";
    else {
      eligibility = debtEligibility(facts, input.options);
      if (eligibility === "ELIGIBLE" && guardians.length === 0) eligibility = "NO_GUARDIAN";
      else if (eligibility === "ELIGIBLE" && emailGuardianIds.length === 0 && mobile === "NONE") eligibility = "NO_CONTACT";
    }
    rows.push({
      studentId: id,
      name: s ? `${s.firstName} ${s.lastName}` : null,
      admissionNumber: s?.admissionNumber ?? null,
      classLabel: s ? (classOf.get(id) ?? null) : null,
      balance: s ? (facts?.balance ?? 0) : 0,
      invoiceCount: s ? (facts?.invoiceCount ?? 0) : 0,
      earliestDueDate: s ? (facts?.earliestDueDate ?? null) : null,
      onPaymentPlan: s ? (facts?.onPaymentPlan ?? false) : false,
      overdue: s ? (facts?.overdue ?? false) : false,
      eligibility,
      planned: eligibility === "ELIGIBLE" ? { emailGuardians: emailGuardianIds.length, mobile } : { emailGuardians: 0, mobile: "NONE" },
    });
    if (eligibility === "ELIGIBLE") plan.push({ studentId: id, emailGuardianIds, mobileGuardianId: mobile === "NONE" ? null : lead!.id });
  }

  // A guardian of several selected children gets one reminder per child.
  const perGuardian = new Map<string, number>();
  for (const p of plan) {
    for (const g of new Set([...p.emailGuardianIds, ...(p.mobileGuardianId ? [p.mobileGuardianId] : [])])) {
      perGuardian.set(g, (perGuardian.get(g) ?? 0) + 1);
    }
  }
  const shared = [...perGuardian.values()].filter((n) => n > 1).length;
  if (shared > 0) {
    batchWarnings.push({
      code: "SHARED_GUARDIANS",
      message: `${shared} guardian${shared === 1 ? " has" : "s have"} more than one selected child and will get one reminder per child.`,
      details: { guardians: shared },
    });
  }

  const excluded = { NOT_FOUND: 0, NO_BALANCE: 0, ON_PAYMENT_PLAN: 0, NOT_OVERDUE: 0, NO_GUARDIAN: 0, NO_CONTACT: 0 };
  for (const r of rows) if (r.eligibility !== "ELIGIBLE") excluded[r.eligibility] += 1;
  const plannedSends = plan.reduce((n, p) => n + p.emailGuardianIds.length + (p.mobileGuardianId ? 1 : 0), 0);
  if (batchErrors.length === 0 && plan.length === 0) {
    batchErrors.push({ code: "NOTHING_TO_SEND", message: "None of the selected students can be reminded. See each student's reason." });
  }

  const summary: ReminderPreview["summary"] = {
    termId: input.termId,
    termLabel,
    templateVersion: REMINDER_TEMPLATE_VERSION,
    options: input.options,
    channels,
    counts: { selected: ids.length, eligible: plan.length, excluded, plannedSends },
    batchErrors,
    batchWarnings,
  };
  // Quiet hours change nothing that is sent, only when: kept out of the
  // fingerprint so a review at 20:59 can still be confirmed at 21:01.
  const previewHash = fingerprint({ v: 1, summary, rows, plan, limits: REMINDER_CAMPAIGN_LIMITS });
  if (isQuietHour(now)) {
    summary.batchWarnings = [
      ...batchWarnings,
      { code: "QUIET_HOURS_HOLD", message: "It is between 21:00 and 06:00: confirmed reminders wait until 06:00." },
    ];
  }
  return { students: rows, summary, plan, previewHash, canConfirm: batchErrors.length === 0 };
}
