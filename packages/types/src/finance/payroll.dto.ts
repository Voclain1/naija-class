import { z } from "zod";

export const payrollStatusValues = ["DRAFT", "APPROVED", "PROCESSING", "PAID", "FAILED"] as const;
export type PayrollStatus = (typeof payrollStatusValues)[number];

// Flat line item — NOT a Nigerian PAYE tax-bracket engine (plan-first D3).
// The bursar computes/enters PAYE (and any other deduction) externally as
// one of these lines; the server only sums them.
export const payrollDeductionSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  // Kobo (Int). Never a float — CLAUDE.md money hard rule.
  amount: z.number().int("Amount must be a whole number of kobo").positive("Amount must be positive"),
});
export type PayrollDeduction = z.infer<typeof payrollDeductionSchema>;

// "2026-07" — free-text period, not a Term/AcademicYear FK. Payroll runs
// monthly; terms don't line up with calendar months.
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must be YYYY-MM");

export const createPayrollItemSchema = z.object({
  userId: z.string().uuid(),
  period: periodSchema,
  grossSalary: z.number().int("Gross salary must be a whole number of kobo").positive("Gross salary must be positive"),
  deductions: z.array(payrollDeductionSchema).max(20).default([]),
});
export type CreatePayrollItemInput = z.infer<typeof createPayrollItemSchema>;

// DRAFT only — enforced in the service, not here. grossSalary/deductions are
// the only editable fields; period/userId are set once at create.
export const updatePayrollItemSchema = z.object({
  grossSalary: z.number().int().positive().optional(),
  deductions: z.array(payrollDeductionSchema).max(20).optional(),
});
export type UpdatePayrollItemInput = z.infer<typeof updatePayrollItemSchema>;

export interface PayrollItemDto {
  id: string;
  schoolId: string;
  userId: string;
  period: string;
  grossSalary: number; // kobo
  deductions: PayrollDeduction[];
  netSalary: number; // kobo — grossSalary - sum(deductions), server-computed
  status: PayrollStatus;
  payslipUrl: string | null; // R2 canonical path; signed on demand via POST /payroll/:id/payslip
  approvedBy: string | null;
  approvedAt: Date | null;
  paystackTransferCode: string | null; // null until CP4
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListPayrollQuery {
  period?: string;
  status?: PayrollStatus;
  userId?: string;
}

export interface PayslipUrlDto {
  url: string;
  expiresAt: Date;
}

// POST /payroll/:id/transfer response — status is always "PROCESSING" at
// this point (PAID/FAILED only arrive later, via the transfer.success/
// failed/reversed webhook). transferCode is Paystack's own transfer_code,
// exposed so the operator's UI can show which Paystack transfer this
// PayrollItem is now waiting on.
export interface TransferPayrollResultDto {
  status: Extract<PayrollStatus, "PROCESSING">;
  transferCode: string;
}
