import { z } from "zod";

import { findWeightSumError } from "./grading-rules.js";

// A single component's editable fields. weight is an integer percent in 0..100;
// the SUM-to-100 invariant is enforced over the whole set (see the bulk schema
// below and the service layer), never on one row in isolation.
const componentFields = {
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  weight: z.number().int().min(0).max(100),
  orderIndex: z.number().int().min(0).max(1000),
};

// POST /grading-scheme/components — add one component. The service re-validates
// the RESULTING set sums to 100 after the insert (a single add usually breaks
// the sum, so the UI's normal path is the bulk PUT below; this endpoint exists
// for completeness + API symmetry).
export const createGradingComponentSchema = z.object(componentFields).strict();
export type CreateGradingComponentInput = z.infer<typeof createGradingComponentSchema>;

// PATCH /grading-scheme/components/:id — edit one component. All fields
// optional; the service re-validates the resulting set.
export const updateGradingComponentSchema = z
  .object(componentFields)
  .partial()
  .strict()
  .refine(
    (d) =>
      d.key !== undefined ||
      d.label !== undefined ||
      d.weight !== undefined ||
      d.orderIndex !== undefined,
    { message: "Provide at least one field to update.", path: ["weight"] },
  );
export type UpdateGradingComponentInput = z.infer<typeof updateGradingComponentSchema>;

// PUT /grading-scheme/components — bulk replace the whole component set. This is
// the settings UI's save path and the ONLY safe way to edit weights, because
// the sum-to-100 invariant is over the entire set.
//
// Refine discipline (class-arm `as never` lesson, deferred.md): the sum issue
// binds to a REAL path (["components"]) — never a bare object-level refine with
// empty path:[], which react-hook-form cannot surface. Duplicate keys bind to
// the offending row's key path so the form can highlight it.
export const replaceGradingComponentsSchema = z
  .object({
    components: z.array(z.object(componentFields).strict()).min(1).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    const sumError = findWeightSumError(value.components.map((c) => c.weight));
    if (sumError) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: sumError, path: ["components"] });
    }

    const seen = new Map<string, number>();
    value.components.forEach((component, index) => {
      const firstIndex = seen.get(component.key);
      if (firstIndex !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate component key "${component.key}".`,
          path: ["components", index, "key"],
        });
      } else {
        seen.set(component.key, index);
      }
    });
  });
export type ReplaceGradingComponentsInput = z.infer<typeof replaceGradingComponentsSchema>;
