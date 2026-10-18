import type {
  CollectionByLevelDto,
  DebtorDto,
  FeeRiskDto,
  FinanceDashboardDto,
  RevenueTrajectoryDto,
  SendRemindersInput,
  SendRemindersResult,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listDebtors(termId: string): Promise<DebtorDto[]> {
  return apiFetch<DebtorDto[]>(`/finance/debtors?termId=${encodeURIComponent(termId)}`, {
    method: "GET",
  });
}

/** Phase 9 / CP10.2 — one child's fee-default risk this term (null: no current term). */
export function getStudentFeeRisk(studentId: string): Promise<FeeRiskDto | null> {
  return apiFetch<FeeRiskDto | null>(`/finance/students/${encodeURIComponent(studentId)}/fee-risk`, {
    method: "GET",
  });
}

export function getFinanceDashboard(termId: string): Promise<FinanceDashboardDto> {
  return apiFetch<FinanceDashboardDto>(`/finance/dashboard?termId=${encodeURIComponent(termId)}`, {
    method: "GET",
  });
}

export function sendReminders(input: SendRemindersInput): Promise<SendRemindersResult> {
  return apiFetch<SendRemindersResult>("/finance/debtors/remind", {
    method: "POST",
    body: input,
  });
}

export function getRevenueTrajectory(termId: string): Promise<RevenueTrajectoryDto> {
  return apiFetch<RevenueTrajectoryDto>(
    `/finance/revenue-trajectory?termId=${encodeURIComponent(termId)}`,
    { method: "GET" },
  );
}

export function getCollectionByLevel(termId: string): Promise<CollectionByLevelDto> {
  return apiFetch<CollectionByLevelDto>(
    `/finance/collection-by-level?termId=${encodeURIComponent(termId)}`,
    { method: "GET" },
  );
}
