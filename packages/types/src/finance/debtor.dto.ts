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
