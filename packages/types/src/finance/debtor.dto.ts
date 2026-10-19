import type { SchoolBankDetails } from "./bank-details.js";
import type { FeeRiskDto } from "./fee-risk.dto.js";
import { formatKobo } from "./format.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Response DTO — one row per outstanding invoice in the debtor list
// ---------------------------------------------------------------------------

export interface DebtorDto {
  invoiceId: string;
  studentId: string;
  studentName: string;         // firstName + " " + lastName
  admissionNumber: string;
  classArm: string;            // e.g. "JSS2 Blue"
  totalDue: number;            // kobo
  totalPaid: number;           // kobo
  balance: number;             // totalDue − totalPaid (kobo), computed server-side
  status: "ISSUED" | "PARTIALLY_PAID" | "OVERDUE";
  dueDate: string | null;      // ISO date (YYYY-MM-DD) or null if not set
  hasPaymentPlan: boolean;
  /** Phase 9 / CP5.1 — a supplementary invoice, not the term invoice. */
  supplementary: boolean;
  /** Phase 9 / CP10.2 — the child's fee-default risk (rules, not a model). */
  risk: FeeRiskDto;
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const listDebtorsSchema = z.object({
  termId: z.string().uuid(),
});
export type ListDebtorsInput = z.infer<typeof listDebtorsSchema>;

/** GET /finance/students/:studentId/fee-risk — the current term when omitted. */
export const studentFeeRiskQuerySchema = z.object({
  termId: z.string().uuid().optional(),
});
export type StudentFeeRiskQuery = z.infer<typeof studentFeeRiskQuerySchema>;

export const sendRemindersSchema = z.object({
  termId: z.string().uuid(),
  studentIds: z.array(z.string().uuid()).min(1).max(50),
});
export type SendRemindersInput = z.infer<typeof sendRemindersSchema>;

// ---------------------------------------------------------------------------
// Response DTO — reminder send result
// ---------------------------------------------------------------------------

/**
 * Why a debtor got no reminder (2026-10-19). Before this the page said "no
 * guardian email" for every skip, whatever the cause, so a school whose
 * guardians all had emails was told they had none.
 */
export const REMINDER_SKIP_REASONS = ["NO_BALANCE", "NO_GUARDIAN", "NO_CONTACT", "NOT_DELIVERED"] as const;
export type ReminderSkipReason = (typeof REMINDER_SKIP_REASONS)[number];

export interface SendRemindersResult {
  sent: number;
  skipped: number;
  /** The skips, by reason. Sums to `skipped`. */
  skippedBy: Record<ReminderSkipReason, number>;
  /**
   * True when no channel could be tried at all: email, SMS and app alerts are
   * all switched off in Settings, or email and SMS are not set up on the
   * server. Every debtor is then skipped, and the reason is the school's
   * settings, not the families.
   */
  noChannel: boolean;
}

const SKIP_TEXT: Record<ReminderSkipReason, (n: number) => string> = {
  NO_BALANCE: (n) => `${n} no longer owe${n === 1 ? "s" : ""} anything this term`,
  NO_GUARDIAN: (n) => `${n} ${n === 1 ? "has" : "have"} no parent or guardian linked`,
  NO_CONTACT: (n) => `${n} ${n === 1 ? "has" : "have"} a guardian with no email, phone or app`,
  NOT_DELIVERED: (n) => `${n} could not be delivered`,
};

/** The line the debtors page shows after sending, in words a bursar acts on. */
export function reminderResultText(r: SendRemindersResult): string {
  const head = `Reminders sent for ${r.sent} student${r.sent === 1 ? "" : "s"}.`;
  if (r.noChannel) {
    return `${head} None could be sent: email, SMS and app alerts are all off or not set up. Turn one on in Settings → Notifications.`;
  }
  const parts = REMINDER_SKIP_REASONS.filter((k) => r.skippedBy[k] > 0).map((k) => SKIP_TEXT[k](r.skippedBy[k]));
  return parts.length ? `${head} Not sent: ${parts.join("; ")}.` : head;
}

// ---------------------------------------------------------------------------
// WhatsApp share — ONE debtor at a time
// ---------------------------------------------------------------------------

/**
 * The message a staff member shares with a single family about an unpaid
 * balance. (Not "a bursar" — many small schools have no such role.)
 *
 * Deliberately per-row, not bulk. `buildNoRecipientWhatsAppUrl` (payment-link.dto)
 * opens WhatsApp with NO recipient — the sender picks the conversation — so it
 * cannot be looped over a debtor list. Real bulk WhatsApp needs the WhatsApp
 * Business API, whose approval state CLAUDE.md still lists as undecided. Bulk
 * reminders go through POST /finance/debtors/remind (email + SMS + push), which
 * already exists and stays the only bulk sender.
 *
 * Uses formatKobo rather than hand-rolling naira formatting — format.ts is
 * documented as the only place that lives. (buildPaymentLinkMessage predates
 * that rule and still formats inline; not changed here, since altering a
 * shipped payment message is not this change's business.)
 */
export function buildDebtorReminderMessage(input: {
  schoolName: string;
  studentName: string;
  balance: number; // kobo
  termName: string;
  dueDate: string | null;
  /** Where this school's parents log in. From SchoolMeDto.portalUrl. */
  portalUrl?: string | null;
  /**
   * A LIVE Paystack payment link for this invoice, for exactly `balance`.
   * Resolve it with shareablePaymentLinkUrl (apps/web), never pass one blindly.
   */
  paymentLinkUrl?: string | null;
  /** Only ever the resolved value — see resolveSchoolBankDetails. */
  bankDetails?: SchoolBankDetails | null;
}): string {
  const due = input.dueDate ? ` It was due on ${input.dueDate}.` : "";

  // Each option is included ONLY when the school actually supports it. A line
  // promising a payment link that does not exist, or a transfer account a
  // school never filled in, is worse than a shorter message — the parent
  // cannot act on it and has to ring the school anyway, which is the outcome
  // this whole message exists to avoid.
  const options: string[] = [];
  if (input.paymentLinkUrl) options.push(`Pay online: ${input.paymentLinkUrl}`);
  if (input.portalUrl) options.push(`Or log in to the parent portal: ${input.portalUrl}`);
  if (input.bankDetails) {
    options.push(
      `Or transfer to ${input.bankDetails.bankAccountName}, ` +
        `${input.bankDetails.bankAccountNumber}, ${input.bankDetails.bankName}`,
    );
  }

  const howToPay = options.length > 0 ? ` ${options.join(". ")}.` : " Please contact the school to settle it.";

  return (
    `${input.schoolName}: ${formatKobo(input.balance)} is outstanding on ` +
    `${input.studentName}'s school fees for ${input.termName}.${due}` +
    howToPay
  );
}
