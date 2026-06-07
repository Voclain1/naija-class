import { z } from "zod";

import type { ReportCardStatusDto } from "./report-card.dto.js";

// Arm-batch workflow actions (Phase 2 / Slice 6). form-review + approve in cp1;
// release + reopen in cp2. Every transition is per (term, classArm) — the whole
// arm's ReportCards advance together in one withTenant tx.
export const reportCardArmActionSchema = z
  .object({
    termId: z.string().trim().min(1),
    classArmId: z.string().trim().min(1),
  })
  .strict();
export type ReportCardArmActionInput = z.infer<typeof reportCardArmActionSchema>;

// Result of a batch transition: the new state + how many cards moved.
export interface ReportCardTransitionResultDto {
  status: ReportCardStatusDto;
  cardCount: number;
}
