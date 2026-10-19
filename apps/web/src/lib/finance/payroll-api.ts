import type {
  CreatePayrollItemInput,
  ListPayrollQuery,
  PayrollItemDto,
  PayslipUrlDto,
  SetStaffSalaryInput,
  StaffSalaryDto,
  TransferPayrollResultDto,
  UpdatePayrollItemInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listPayroll(query: ListPayrollQuery = {}): Promise<PayrollItemDto[]> {
  const params = new URLSearchParams();
  if (query.period) params.set("period", query.period);
  if (query.status) params.set("status", query.status);
  if (query.userId) params.set("userId", query.userId);
  const qs = params.toString();
  return apiFetch<PayrollItemDto[]>(`/payroll${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export function createPayrollItem(input: CreatePayrollItemInput): Promise<PayrollItemDto> {
  return apiFetch<PayrollItemDto>("/payroll", { method: "POST", body: input });
}

export function updatePayrollItem(id: string, input: UpdatePayrollItemInput): Promise<PayrollItemDto> {
  return apiFetch<PayrollItemDto>(`/payroll/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
}

export function approvePayrollItem(id: string): Promise<PayrollItemDto> {
  return apiFetch<PayrollItemDto>(`/payroll/${encodeURIComponent(id)}/approve`, { method: "POST" });
}

export function generatePayslip(id: string): Promise<PayslipUrlDto> {
  return apiFetch<PayslipUrlDto>(`/payroll/${encodeURIComponent(id)}/payslip`, { method: "POST" });
}

// POST /payroll/:id/transfer — payroll.transfer only (owner+admin). Returns
// PROCESSING immediately; PAID/FAILED arrive later via the Paystack webhook,
// so the caller must re-fetch (or poll) to see the resolved status.
export function transferPayrollItem(id: string): Promise<TransferPayrollResultDto> {
  return apiFetch<TransferPayrollResultDto>(`/payroll/${encodeURIComponent(id)}/transfer`, {
    method: "POST",
  });
}

// Saved monthly salaries (2026-10-19), payroll.process. Set on the invite form
// or a staff member's page; "Run payroll" fills its gross from them.
export function listStaffSalaries(): Promise<StaffSalaryDto[]> {
  return apiFetch<StaffSalaryDto[]>("/payroll/salaries", { method: "GET" });
}

export function setStaffSalary(userId: string, input: SetStaffSalaryInput): Promise<StaffSalaryDto> {
  return apiFetch<StaffSalaryDto>(`/payroll/salaries/${encodeURIComponent(userId)}`, { method: "PUT", body: input });
}
