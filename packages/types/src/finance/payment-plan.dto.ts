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
