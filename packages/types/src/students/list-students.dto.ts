import { z } from "zod";

// GET /students — cursor-paginated, optional filters.
//
// `cursor` is an opaque Student id; pass back `meta.cursor` from a
// previous response to fetch the next page. `limit` defaults to 50, max
// 200 (a single admin click should not be able to pull a whole school).
//
// Slice 9: `classArmId` is now a real filter — restricts to students
// whose CURRENT-term enrollment is in that arm. `academicYearId` stays
// accepted-but-unused; a more nuanced "ever-enrolled-in-year" filter
// would join differently (no isCurrent constraint) and is deferred
// until a UI surface requires it.
export const listStudentsQuerySchema = z
  .object({
    status: z
      .enum(["ACTIVE", "INACTIVE", "WITHDRAWN", "GRADUATED", "SUSPENDED"])
      .optional(),
    search: z.string().trim().min(1).max(100).optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    classArmId: z.string().uuid().optional(),
    // Reserved — accepted but unused until a UI surface needs it.
    academicYearId: z.string().uuid().optional(),
  })
  .strict();

export type ListStudentsQuery = z.infer<typeof listStudentsQuerySchema>;
