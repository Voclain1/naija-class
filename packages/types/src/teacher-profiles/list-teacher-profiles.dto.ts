import { z } from "zod";

// GET /teacher-profiles?search=&specialty= — cursor-paginated.
//
// Per phase-1.md API table. Filters:
//   - search    — matches staffNumber OR the user's first/last name
//                 (ILIKE contains; same pragmatic shape as student search,
//                 sequential-scan-fine at pilot scale — pg_trgm deferred).
//   - specialty — exact-ish ILIKE contains on the specialty column.
//
// `cursor` is an opaque TeacherProfile id; `limit` defaults to 50, max 200.

export const listTeacherProfilesQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(100).optional(),
    specialty: z.string().trim().min(1).max(120).optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export type ListTeacherProfilesQuery = z.infer<
  typeof listTeacherProfilesQuerySchema
>;
