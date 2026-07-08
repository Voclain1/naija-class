import { z } from "zod";

export const createExpenseCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
});

export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;

export const updateExpenseCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  active: z.boolean().optional(),
});

export type UpdateExpenseCategoryInput = z.infer<typeof updateExpenseCategorySchema>;

export interface ExpenseCategoryDto {
  id: string;
  schoolId: string;
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  // Present on findAll/findById — count of expenses referencing this
  // category. Since categoryId is a plain FK (no Prisma relation — see
  // schema.prisma header comment on Expense), this is a manual
  // db.expense.count() the service computes, not a Prisma `_count` include.
  expenseCount?: number;
}
