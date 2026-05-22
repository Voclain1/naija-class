import { z } from "zod";

// PATCH /academic-years/:id — every field optional, at least one required.
//
// The cross-field date refine only fires when BOTH endDate and startDate are
// present in the payload. Single-field updates (e.g. just shifting the
// endDate later) are validated by the service against the current row.
export const updateAcademicYearSchema = z
  .object({
    label: z.string().trim().min(1).max(20).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field is required",
  })
  .refine(
    (d) => d.startDate === undefined || d.endDate === undefined || d.endDate > d.startDate,
    { message: "endDate must be after startDate", path: ["endDate"] },
  );

export type UpdateAcademicYearInput = z.infer<typeof updateAcademicYearSchema>;
