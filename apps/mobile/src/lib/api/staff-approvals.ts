import type {
  CompletenessReportDto,
  ReportCardArmActionInput,
  ReportCardArmReopenInput,
  ReportCardBoardResponse,
  ReportCardTransitionResultDto,
} from "@school-kit/types";

import { apiFetch } from "./client";

// CP4b — report card approval for owners and admins.
//
// D34: the overview is ONE call. `GET /reports/completeness` already returns
// a per-class pipeline with a count per status, so the list of classes does
// not need one board request per class — N round trips on a Nigerian mobile
// network just to draw a list. The per-class board is fetched only when a head
// opens a class.
//
// The three transitions are ARM-level batch operations, and the server
// refuses any class where not every card is in the right state
// (`assertAllInState`, 409 INVALID_TRANSITION). approval-stage.ts mirrors that
// rule so the phone offers only what will be accepted — but the server stays
// the authority, and its refusal is shown if the two ever disagree.

/** `termId` omitted → the school's current term (the endpoint's own default). */
export function staffCompleteness(termId?: string): Promise<CompletenessReportDto> {
  const query = termId ? `?${new URLSearchParams({ termId }).toString()}` : "";
  return apiFetch<CompletenessReportDto>(`/reports/completeness${query}`);
}

export function staffReportCardBoard(
  termId: string,
  classArmId: string,
): Promise<ReportCardBoardResponse> {
  const params = new URLSearchParams({ termId, classArmId });
  return apiFetch<ReportCardBoardResponse>(`/report-cards?${params.toString()}`);
}

export function staffApproveArm(input: ReportCardArmActionInput): Promise<ReportCardTransitionResultDto> {
  return apiFetch<ReportCardTransitionResultDto>("/report-cards/arm/approve", {
    method: "POST",
    body: input,
  });
}

/**
 * Release: the moment families can read the cards, and the cards freeze
 * (released-guard.ts). The screen confirms before calling this (D33).
 */
export function staffReleaseArm(input: ReportCardArmActionInput): Promise<ReportCardTransitionResultDto> {
  return apiFetch<ReportCardTransitionResultDto>("/report-cards/arm/release", {
    method: "POST",
    body: input,
  });
}

/** Reopen: an audited rollback to DRAFT. The server REQUIRES a reason. */
export function staffReopenArm(input: ReportCardArmReopenInput): Promise<ReportCardTransitionResultDto> {
  return apiFetch<ReportCardTransitionResultDto>("/report-cards/arm/reopen", {
    method: "POST",
    body: input,
  });
}
