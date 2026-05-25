import { z } from "zod";

// GET /students — cursor-paginated, optional filters.
//
// `cursor` is an opaque Student id; pass back `meta.cursor` from a
// previous response to fetch the next page. `limit` defaults to 50, max
// 200 (a single admin click should not be able to pull a whole school).
//
// `classArmId` and `academicYearId` are silently accepted and ignored
// until slice 9 lands Enrollment — keeping the query shape stable so the
// UI can write the call once and have it work both before and after the
// enrollment filter goes live.
export const listStudentsQuerySchema = z
  .object({
    status: z
      .enum(["ACTIVE", "INACTIVE", "WITHDRAWN", "GRADUATED", "SUSPENDED"])
      .optional(),
    search: z.string().trim().min(1).max(100).optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    // Reserved for slice 9 — accepted but ignored today.
    classArmId: z.string().uuid().optional(),
    academicYearId: z.string().uuid().optional(),
  })
  .strict();

export type ListStudentsQuery = z.infer<typeof listStudentsQuerySchema>;
