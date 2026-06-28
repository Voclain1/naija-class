import { z } from "zod";

export const createFeeCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
});

export type CreateFeeCategoryInput = z.infer<typeof createFeeCategorySchema>;

export const updateFeeCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
});

export type UpdateFeeCategoryInput = z.infer<typeof updateFeeCategorySchema>;

export interface FeeCategoryDto {
  id: string;
  schoolId: string;
  name: string;
  description: string | null;
  active: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  itemCount?: number;
}
