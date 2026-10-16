import type {
  ArmChargesStudentDto,
  BillWaitingChargesInput,
  BillWaitingChargesResponseDto,
  RaiseStudentChargeInput,
  StudentChargeDto,
  WaitingChargesPreviewDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// Phase 9 / CP5.1 — student charges and supplementary invoices
// (docs/modules/phase-9.md §13).

export function listArmCharges(params: { termId: string; classArmId: string }): Promise<ArmChargesStudentDto[]> {
  const qs = new URLSearchParams(params);
  return apiFetch<ArmChargesStudentDto[]>(`/student-charges/arm?${qs}`, { method: "GET" });
}

export function raiseCharge(input: RaiseStudentChargeInput): Promise<StudentChargeDto> {
  return apiFetch<StudentChargeDto>("/student-charges", { method: "POST", body: input });
}

export function voidCharge(id: string, reason: string): Promise<StudentChargeDto> {
  return apiFetch<StudentChargeDto>(`/student-charges/${encodeURIComponent(id)}/void`, {
    method: "POST",
    body: { reason },
  });
}

export function previewWaitingCharges(termId: string): Promise<WaitingChargesPreviewDto> {
  return apiFetch<WaitingChargesPreviewDto>(`/invoices/waiting-charges?${new URLSearchParams({ termId })}`, {
    method: "GET",
  });
}

export function billWaitingCharges(input: BillWaitingChargesInput): Promise<BillWaitingChargesResponseDto> {
  return apiFetch<BillWaitingChargesResponseDto>("/invoices/waiting-charges/bill", { method: "POST", body: input });
}
