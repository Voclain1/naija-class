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
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const listDebtorsSchema = z.object({
  termId: z.string().uuid(),
});
export type ListDebtorsInput = z.infer<typeof listDebtorsSchema>;

export const sendRemindersSchema = z.object({
  termId: z.string().uuid(),
  studentIds: z.array(z.string().uuid()).min(1).max(50),
});
export type SendRemindersInput = z.infer<typeof sendRemindersSchema>;

// ---------------------------------------------------------------------------
// Response DTO — reminder send result
// ---------------------------------------------------------------------------

export interface SendRemindersResult {
  sent: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// WhatsApp share — ONE debtor at a time
// ---------------------------------------------------------------------------

/**
 * The message a bursar shares with a single family about an unpaid balance.
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
}): string {
  const due = input.dueDate ? ` It was due on ${input.dueDate}.` : "";
  return (
    `${input.schoolName}: ${formatKobo(input.balance)} is outstanding on ` +
    `${input.studentName}'s school fees for ${input.termName}.${due} ` +
    `Please contact the bursar to settle it.`
  );
}
