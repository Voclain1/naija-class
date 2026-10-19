import { z } from "zod";

// ---------------------------------------------------------------------------
// Phase 9 / CP5.1 — student charges (F2, docs/modules/phase-9.md §13).
//
// One amount owed by one student for one term. OPEN until an invoice carries
// it (the term invoice when it is generated, or a supplementary invoice when
// the bursar bills waiting charges), or VOID with a reason. Money is kobo.
// ---------------------------------------------------------------------------

export const studentChargeKindValues = ["TRANSPORT", "LIBRARY_FINE", "HOSTEL", "OTHER", "STORE"] as const;
export type StudentChargeKind = (typeof studentChargeKindValues)[number];

export const studentChargeStatusValues = ["OPEN", "BILLED", "VOID"] as const;
export type StudentChargeStatus = (typeof studentChargeStatusValues)[number];

/** The category a charge line shows under on an invoice. */
export const STUDENT_CHARGE_KIND_LABELS: Record<StudentChargeKind, string> = {
  TRANSPORT: "Transport",
  LIBRARY_FINE: "Library",
  HOSTEL: "Hostel",
  OTHER: "Other charges",
  STORE: "School store",
};

/** ₦10,000,000 in kobo — the database's own ceiling. */
export const MAX_STUDENT_CHARGE_KOBO = 1_000_000_000;

export interface StudentChargeDto {
  id: string;
  studentId: string;
  termId: string;
  kind: StudentChargeKind;
  description: string;
  amount: number; // kobo
  status: StudentChargeStatus;
  /** "transport" and the like; null for a charge added by hand. */
  sourceModule: string | null;
  invoiceId: string | null;
  /** True when the invoice carrying it is a supplementary one. */
  onSupplementaryInvoice: boolean;
  voidReason: string | null;
  voidedAt: string | null;
  createdAt: string;
}

export const listStudentChargesSchema = z.object({
  studentId: z.string().uuid(),
  termId: z.string().uuid().optional(),
});
export type ListStudentChargesInput = z.infer<typeof listStudentChargesSchema>;

/** A class's students for a term, each with their charges (the Charges page). */
export const listArmChargesSchema = z.object({
  termId: z.string().uuid(),
  classArmId: z.string().uuid(),
});
export type ListArmChargesInput = z.infer<typeof listArmChargesSchema>;

export interface ArmChargesStudentDto {
  studentId: string;
  studentName: string | null;
  admissionNumber: string | null;
  charges: StudentChargeDto[];
}

/** Adding a charge by hand is always kind OTHER (CP5-D5). */
export const raiseStudentChargeSchema = z.object({
  studentId: z.string().uuid(),
  termId: z.string().uuid(),
  description: z.string().trim().min(1).max(200),
  amount: z.number().int().positive().max(MAX_STUDENT_CHARGE_KOBO),
});
export type RaiseStudentChargeInput = z.infer<typeof raiseStudentChargeSchema>;

export const voidStudentChargeSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type VoidStudentChargeInput = z.infer<typeof voidStudentChargeSchema>;

// ─── Billing waiting charges (supplementary invoices, CP5-D3) ──────────────

export const previewWaitingChargesSchema = z.object({
  termId: z.string().uuid(),
});
export type PreviewWaitingChargesInput = z.infer<typeof previewWaitingChargesSchema>;

export const billWaitingChargesSchema = z.object({
  termId: z.string().uuid(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD").optional(),
});
export type BillWaitingChargesInput = z.infer<typeof billWaitingChargesSchema>;

export interface WaitingChargesStudentDto {
  studentId: string;
  studentName: string | null;
  admissionNumber: string | null;
  chargeCount: number;
  total: number; // kobo
}

export interface WaitingChargesPreviewDto {
  /** Students with a term invoice and OPEN charges: billed by "Bill waiting charges". */
  toBill: WaitingChargesStudentDto[];
  totalToBill: number; // kobo
  /**
   * Students with OPEN charges but no term invoice yet. Left alone: their
   * charges ride on the term invoice when it is generated.
   */
  waitingForTermInvoice: number;
}

export interface BillWaitingChargesResponseDto {
  created: number;
  chargesBilled: number;
  total: number; // kobo
}
