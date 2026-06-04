import { z } from "zod";

// POST /report-cards/arm/build — materialize DRAFT cards for an arm-term. The
// service runs the slice-4 full aggregation in-tx, snapshots the rollup onto
// each card, and upserts one DRAFT ReportCard per enrolled student.
export const buildReportCardsSchema = z
  .object({
    termId: z.string().trim().min(1),
    classArmId: z.string().trim().min(1),
  })
  .strict();
export type BuildReportCardsInput = z.infer<typeof buildReportCardsSchema>;

// GET /report-cards?termId=&classArmId=&status= — the workflow board feed. The
// optional status narrows the board to one workflow state.
export const reportCardBoardQuerySchema = z
  .object({
    termId: z.string().trim().min(1),
    classArmId: z.string().trim().min(1),
    status: z
      .enum(["DRAFT", "SUBJECT_REVIEWED", "FORM_REVIEWED", "PRINCIPAL_APPROVED", "RELEASED"])
      .optional(),
  })
  .strict();
export type ReportCardBoardQuery = z.infer<typeof reportCardBoardQuerySchema>;
