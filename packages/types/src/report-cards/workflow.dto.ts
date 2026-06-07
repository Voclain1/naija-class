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

// POST /report-cards/arm/reopen (cp2) — audited rollback to DRAFT. `reason` is
// REQUIRED and non-empty (the audit trail's whole point — why was a finalised
// arm reopened).
export const reportCardArmReopenSchema = z
  .object({
    termId: z.string().trim().min(1),
    classArmId: z.string().trim().min(1),
    reason: z.string().trim().min(1, "A reason is required to reopen an arm."),
  })
  .strict();
export type ReportCardArmReopenInput = z.infer<typeof reportCardArmReopenSchema>;

// PATCH /report-cards/:id (cp2) — per-card form-teacher comment. Optional +
// nullable: omit → no change, null → clear, string → set. AI-hook-ready
// (Phase 5 writes the same field behind the same approval gate).
export const reportCardCommentUpdateSchema = z
  .object({
    formTeacherComment: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type ReportCardCommentUpdateInput = z.infer<typeof reportCardCommentUpdateSchema>;

// PUT /report-cards/arm/principal-note (cp2) — the arm-term principal note,
// fanned out identically onto every card in (term, arm). Same optional+nullable
// semantics as the form comment.
export const principalNoteUpdateSchema = z
  .object({
    termId: z.string().trim().min(1),
    classArmId: z.string().trim().min(1),
    principalNote: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type PrincipalNoteUpdateInput = z.infer<typeof principalNoteUpdateSchema>;

// Result of the arm-level principal-note fan-out: how many cards were updated.
export interface PrincipalNoteResultDto {
  cardCount: number;
}
