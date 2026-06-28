import { z } from "zod";

export const createFeeItemSchema = z
  .object({
    categoryId: z.string().uuid(),
    name: z.string().min(1, "Name is required").max(200),
    // Stored in kobo (Int). Must be a positive whole number — never a float.
    amount: z.number().int("Amount must be a whole number of kobo").positive("Amount must be positive"),
    classLevelId: z.string().uuid().optional(),
    classArmId: z.string().uuid().optional(),
    termId: z.string().uuid().optional(),
    academicYearId: z.string().uuid().optional(),
  })
  .refine((data) => !data.classArmId || !!data.classLevelId, {
    message: "classArmId cannot be set without classLevelId (an arm is always a child of a level)",
    path: ["classArmId"],
  });

export type CreateFeeItemInput = z.infer<typeof createFeeItemSchema>;

export const updateFeeItemSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    amount: z.number().int().positive().optional(),
    classLevelId: z.string().uuid().nullable().optional(),
    classArmId: z.string().uuid().nullable().optional(),
    termId: z.string().uuid().nullable().optional(),
    academicYearId: z.string().uuid().nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // Reject the explicitly-inconsistent case where classArmId is being set
      // to a non-null value while classLevelId is being explicitly cleared.
      // Full post-merge validation (arm vs existing level) is done in the service.
      if (data.classArmId !== undefined && data.classArmId !== null) {
        if (data.classLevelId === null) return false;
      }
      return true;
    },
    {
      message: "classArmId cannot remain set when classLevelId is being cleared",
      path: ["classArmId"],
    },
  );

export type UpdateFeeItemInput = z.infer<typeof updateFeeItemSchema>;

export interface FeeItemDto {
  id: string;
  schoolId: string;
  categoryId: string;
  name: string;
  // Kobo (Int). Display layer converts to naira — never formatted here.
  amount: number;
  classLevelId: string | null;
  classArmId: string | null;
  termId: string | null;
  academicYearId: string | null;
  active: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
