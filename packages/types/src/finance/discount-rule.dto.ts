import { z } from "zod";

export const discountDurationValues = ["TERM", "SESSION", "LIFETIME"] as const;
export type DiscountDuration = (typeof discountDurationValues)[number];

export const discountTypeValues = ["PERCENTAGE", "FIXED_AMOUNT", "FULL_WAIVER"] as const;
export type DiscountType = (typeof discountTypeValues)[number];

export const createDiscountRuleSchema = z
  .object({
    studentId: z.string().uuid(),
    name: z.string().min(1, "Name is required").max(200),
    // Exactly one of feeItemId / feeCategoryId must be set (XOR — refine below).
    feeItemId: z.string().uuid().optional(),
    feeCategoryId: z.string().uuid().optional(),
    duration: z.enum(discountDurationValues),
    termId: z.string().uuid().optional(),          // required when duration = TERM
    academicYearId: z.string().uuid().optional(),  // required when duration = SESSION
    discountType: z.enum(discountTypeValues),
    // basis points (PERCENTAGE: 1–9999) | kobo (FIXED_AMOUNT: positive Int) | omit/null (FULL_WAIVER)
    value: z.number().int().positive().optional(),
  })
  .refine((d) => (!!d.feeItemId) !== (!!d.feeCategoryId), {
    message: "Exactly one of feeItemId or feeCategoryId must be set",
    path: ["feeItemId"],
  })
  .refine((d) => d.duration !== "TERM" || !!d.termId, {
    message: "termId is required when duration is TERM",
    path: ["termId"],
  })
  .refine((d) => d.duration !== "SESSION" || !!d.academicYearId, {
    message: "academicYearId is required when duration is SESSION",
    path: ["academicYearId"],
  })
  .refine((d) => d.discountType === "FULL_WAIVER" || d.value !== undefined, {
    message: "value is required for PERCENTAGE and FIXED_AMOUNT discount types",
    path: ["value"],
  })
  .refine(
    (d) =>
      d.discountType !== "PERCENTAGE" ||
      (d.value !== undefined && d.value >= 1 && d.value <= 9999),
    {
      // 1 = 0.01%, 9999 = 99.99%. Use FULL_WAIVER for a 100% waiver.
      message: "PERCENTAGE value must be between 1 and 9999 basis points (0.01%–99.99%)",
      path: ["value"],
    },
  );

export type CreateDiscountRuleInput = z.infer<typeof createDiscountRuleSchema>;

// Only name and value are mutable after creation. All other fields are write-once:
// changing discountType, duration, studentId, feeItemId, or feeCategoryId would
// silently alter live discount behaviour. The correct action is deactivate + create.
export const updateDiscountRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  // New value in basis points (PERCENTAGE) or kobo (FIXED_AMOUNT). Ignored by service
  // if the existing rule is FULL_WAIVER (no value field to update on that type).
  value: z.number().int().positive().optional(),
});

export type UpdateDiscountRuleInput = z.infer<typeof updateDiscountRuleSchema>;

export interface DiscountRuleDto {
  id: string;
  schoolId: string;
  studentId: string;
  name: string;
  feeItemId: string | null;
  feeCategoryId: string | null;
  duration: DiscountDuration;
  termId: string | null;
  academicYearId: string | null;
  discountType: DiscountType;
  // basis points (PERCENTAGE) | kobo (FIXED_AMOUNT) | null (FULL_WAIVER)
  value: number | null;
  active: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
