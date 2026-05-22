import { z } from "zod";

// POST /academic-years — body schema.
//
// `label` is free-text but capped so a paste of a paragraph can't blow up
// rendering. Typical Nigerian-school value is "2025/2026" (or "2025-26");
// no format is enforced — schools spell theirs differently and we don't
// want to police a non-load-bearing string.
//
// Dates are coerced from ISO strings (what the browser sends from
// <input type="date">). The cross-field refine enforces endDate > startDate
// at the edge so the service layer can trust the shape.
export const createAcademicYearSchema = z
  .object({
    label: z.string().trim().min(1).max(20),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .strict()
  .refine((d) => d.endDate > d.startDate, {
    message: "endDate must be after startDate",
    path: ["endDate"],
  });

export type CreateAcademicYearInput = z.infer<typeof createAcademicYearSchema>;
