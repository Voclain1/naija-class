import { z } from "zod";

// POST /academic-years/:yearId/terms — body schema.
//
// `sequence` is constrained to 1..3 because the Nigerian academic year is
// universally three terms. If a future school says otherwise we'll loosen
// this here; the partial-unique-index per (academicYearId, sequence) means
// only sequence values that round-trip the constraint will land.
//
// The service additionally enforces that startDate/endDate fall within the
// parent year's range — that lookup needs the year row, so it lives in the
// service rather than the Zod schema.
export const createTermSchema = z
  .object({
    sequence: z.number().int().min(1).max(3),
    name: z.string().trim().min(1).max(40),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .strict()
  .refine((d) => d.endDate > d.startDate, {
    message: "endDate must be after startDate",
    path: ["endDate"],
  });

export type CreateTermInput = z.infer<typeof createTermSchema>;
