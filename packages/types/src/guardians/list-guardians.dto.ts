import { z } from "zod";

// GET /guardians — cursor-paginated, optional filters.
//
// `cursor` is an opaque Guardian id; pass back `meta.cursor` from a
// previous response to fetch the next page. `limit` defaults to 50, max
// 200 — same caps as listStudentsQuerySchema.
//
// `search` matches firstName, lastName, or phone (OR'd, case-insensitive).
// `studentId` filters to guardians currently linked to that student.
export const listGuardiansQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(100).optional(),
    studentId: z.string().uuid().optional(),
    // Portal standing (2026-09-16). Filtered IN THE DATABASE, not over a
    // loaded page: a client-side filter over cursor pages would show "no
    // parents awaiting an invite" on page one while page three had forty.
    // The where-clauses in GuardiansService mirror deriveGuardianPortalStatus
    // rule for rule, and a parity spec holds them together.
    portalStatus: z.enum(["NO_EMAIL", "NOT_INVITED", "INVITED", "EXPIRED", "ACTIVE"]).optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export type ListGuardiansQuery = z.infer<typeof listGuardiansQuerySchema>;
