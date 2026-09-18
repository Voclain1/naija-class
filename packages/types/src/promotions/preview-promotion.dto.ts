import { z } from "zod";

// GET /promotions/preview — query schema.
//
// Both terms are explicit. There is deliberately NO "guess the source term"
// default at the API: the 2026-08-25 carry-over incident was a silent default
// deciding who moved, and this endpoint's whole output is a list of who moves.
// The WEB page pre-selects sensible terms and shows them, which is a different
// thing — the admin can see and change what was picked before any row loads.
export const previewPromotionQuerySchema = z
  .object({
    sourceTermId: z.string().uuid(),
    targetTermId: z.string().uuid(),
  })
  .strict();

export type PreviewPromotionQuery = z.infer<typeof previewPromotionQuerySchema>;
