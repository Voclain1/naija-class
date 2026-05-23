import { z } from "zod";

// POST /class-levels/:levelId/class-subjects/bulk — atomic create + delete
// of class-subject links for a single class level. Drives the matrix UI's
// save action: the UI batches every toggle for one level row into one
// request, the server runs the create/delete pair inside a single
// withTenant transaction, and either every change lands or none do.
//
// Why one endpoint instead of two (bulk-create + bulk-delete):
//   - Atomicity. The matrix's "save changes" CTA expects a single all-or-
//     nothing commit. Two endpoints would let the create succeed and the
//     delete fail, leaving an inconsistent intermediate state.
//   - Round-trips. A 14×20 grid generates O(N) toggles on save; one POST
//     beats 280 PATCHes.
//
// Both arrays may be empty individually but not both at once; if both are
// empty the call is a no-op and we reject it at validation time to keep
// the audit log clean (no "imports zero rows" entries).
export const bulkClassSubjectsSchema = z
  .object({
    create: z
      .array(
        z
          .object({
            subjectId: z.string().uuid(),
            isCore: z.boolean().optional(),
          })
          .strict(),
      )
      .default([]),
    delete: z.array(z.string().uuid()).default([]),
  })
  .strict()
  .refine((d) => d.create.length > 0 || d.delete.length > 0, {
    message: "At least one of `create` or `delete` must be non-empty",
  });

export type BulkClassSubjectsInput = z.infer<typeof bulkClassSubjectsSchema>;
