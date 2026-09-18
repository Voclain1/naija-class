// Typed wrappers around the promotion engine endpoints.
// See docs/modules/promotion-engine.md.

import type {
  CommitPromotionInput,
  PreviewPromotionQuery,
  PromotionCommitResultDto,
  PromotionPreviewDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function previewPromotion(
  query: PreviewPromotionQuery,
): Promise<PromotionPreviewDto> {
  const params = new URLSearchParams({
    sourceTermId: query.sourceTermId,
    targetTermId: query.targetTermId,
  });
  return apiFetch<PromotionPreviewDto>(`/promotions/preview?${params}`, {
    method: "GET",
  });
}

export function commitPromotion(
  input: CommitPromotionInput,
): Promise<PromotionCommitResultDto> {
  return apiFetch<PromotionCommitResultDto>("/promotions/commit", {
    method: "POST",
    body: input,
  });
}
