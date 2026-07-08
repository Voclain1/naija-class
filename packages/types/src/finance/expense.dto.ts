import { z } from "zod";

export const createExpenseSchema = z.object({
  categoryId: z.string().uuid(),
  // Kobo (Int). Never a float — CLAUDE.md money hard rule.
  amount: z.number().int("Amount must be a whole number of kobo").positive("Amount must be positive"),
  description: z.string().max(500).optional(),
  incurredAt: z.string().date(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = z.object({
  categoryId: z.string().uuid().optional(),
  amount: z.number().int().positive().optional(),
  description: z.string().max(500).nullable().optional(),
  incurredAt: z.string().date().optional(),
});

export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export interface ExpenseDto {
  id: string;
  schoolId: string;
  categoryId: string;
  amount: number; // kobo
  description: string | null;
  incurredAt: Date;
  receiptUrl: string | null; // R2 canonical path; signed on demand via GET /expenses/:id/receipt
  recordedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListExpensesQuery {
  categoryId?: string;
  from?: string; // incurredAt >= from (date string)
  to?: string; // incurredAt <= to (date string)
}
