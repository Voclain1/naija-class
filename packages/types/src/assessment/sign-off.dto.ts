import { z } from "zod";

// POST /assessments/sign-off/bulk — a subject teacher signs off a whole column:
// every (student × subject) Assessment in (classArmId, subjectId, termId). The
// single-row sign-off (POST /assessments/:id/sign-off) takes no body — the id is
// in the path — so it needs no schema.
export const signOffBulkSchema = z
  .object({
    termId: z.string().trim().min(1),
    subjectId: z.string().trim().min(1),
    classArmId: z.string().trim().min(1),
  })
  .strict();

export type SignOffBulkInput = z.infer<typeof signOffBulkSchema>;
