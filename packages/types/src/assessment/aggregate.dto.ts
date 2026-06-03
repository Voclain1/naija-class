import { z } from "zod";

// POST /assessments/aggregate — recompute positions for an arm-term. Omit
// subjectId for a FULL arm pass (every subject's subjectPosition + the overall
// classPosition); provide subjectId for a NARROW pass (one subject's
// subjectPosition only — classPosition is left untouched, the (j) invariant).
export const aggregateInputSchema = z
  .object({
    termId: z.string().trim().min(1),
    classArmId: z.string().trim().min(1),
    subjectId: z.string().trim().min(1).optional(),
  })
  .strict();
export type AggregateInput = z.infer<typeof aggregateInputSchema>;

export interface AggregateResultDto {
  mode: "subject" | "full";
  studentCount: number;
  updateCount: number;
}

// GET /assessments/aggregate/status?termId=&classArmId=
export const aggregateStatusQuerySchema = z
  .object({
    termId: z.string().trim().min(1),
    classArmId: z.string().trim().min(1),
  })
  .strict();
export type AggregateStatusQuery = z.infer<typeof aggregateStatusQuerySchema>;

export interface AggregateSubjectStatusDto {
  subjectId: string;
  lastComputedAt: string | Date | null;
}

// `overall` is the last FULL pass (max positionsComputedAt where classPosition
// is set); `perSubject[].lastComputedAt` captures both narrow + full passes for
// that subject.
export interface AggregateStatusResponse {
  perSubject: AggregateSubjectStatusDto[];
  overall: string | Date | null;
}
