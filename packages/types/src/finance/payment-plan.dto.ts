import { z } from "zod";

// ---------------------------------------------------------------------------
// Input schemas — Slice 9 installment plans
// ---------------------------------------------------------------------------

export const createInstallmentSchema = z.object({
  amount: z.number().int().positive(),
  // ISO date string "YYYY-MM-DD" — no time component.
  dueDate: z.string().date(),
});
export type CreateInstallmentInput = z.infer<typeof createInstallmentSchema>;

export const createPaymentPlanSchema = z.object({
  invoiceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  installments: z.array(createInstallmentSchema).min(1),
});
export type CreatePaymentPlanInput = z.infer<typeof createPaymentPlanSchema>;

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export interface PaymentPlanInstallmentDto {
  id: string;
  planId: string;
  amount: number;   // kobo
  dueDate: string;  // ISO date "YYYY-MM-DD"
  paid: boolean;
  /** Display projection for existing untargeted invoice payments, in kobo. */
  amountPaid?: number;
  outstanding?: number;
  isOverdue: boolean; // computed: !paid && dueDate < today (read-time, not stored)
}

export interface PaymentPlanDto {
  id: string;
  schoolId: string;
  invoiceId: string;
  name: string;
  createdBy: string;
  createdAt: Date;
  installments: PaymentPlanInstallmentDto[];
}

export const installmentPolicySchema = z.object({
  enabled: z.boolean(),
  maxInstallments: z.number().int().min(2).max(12),
  minimumFirstKobo: z.number().int().min(0).max(2_147_483_647),
  requireWithinTerm: z.boolean(),
}).strict();
export type InstallmentPolicy = z.infer<typeof installmentPolicySchema>;

export const installmentProposalSchema = z.array(createInstallmentSchema).min(2).max(12);
export const installmentRequestDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("APPROVE"), revision: z.number().int().positive() }),
  z.object({ action: z.literal("REJECT"), revision: z.number().int().positive() }),
  z.object({ action: z.literal("COUNTER"), revision: z.number().int().positive(), schedule: installmentProposalSchema }),
]);
export type InstallmentRequestDecision = z.infer<typeof installmentRequestDecisionSchema>;

export interface InstallmentRequestDto {
  id: string;
  invoiceId: string;
  status: string;
  schedule: CreateInstallmentInput[];
  revision: number;
}
