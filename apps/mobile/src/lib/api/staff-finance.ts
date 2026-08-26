import type {
  AcademicYearDto,
  DebtorDto,
  FinanceDashboardDto,
  TermDto,
} from "@school-kit/types";

import { apiFetch } from "./client";

// CP3 bursar collection-monitoring bindings.
//
// READ-ONLY, and that is the checkpoint's defining property rather than an
// omission. The plan-first puts "payment recording or approval" and refunds
// behind a web-only line; monitoring is what is left, and it is genuinely
// useful on its own — a bursar in a corridor can see where collections stand
// without being able to move a naira from the handset.
//
// Every endpoint here already exists and the bursar role already holds every
// permission involved (finance.dashboard.read, finance.debtors.read,
// term.read, academic-year.read), so CP3 adds no server surface — the same
// property CP2 established and Gate 0 tested rather than asserted.
//
// Deliberately ABSENT: `GET /payments`. PaymentDto carries studentId and no
// studentName, so a "recent money in" feed would render opaque uuids or need
// one extra request per row. Dropped from scope rather than worked around on
// the client; see finance.mobile-cp3.spec.ts, which pins that constraint.

export function staffAcademicYears(): Promise<AcademicYearDto[]> {
  return apiFetch<AcademicYearDto[]>("/academic-years");
}

export function staffTermsOfYear(yearId: string): Promise<TermDto[]> {
  return apiFetch<TermDto[]>(`/academic-years/${encodeURIComponent(yearId)}/terms`);
}

export function staffFinanceDashboard(termId: string): Promise<FinanceDashboardDto> {
  const query = new URLSearchParams({ termId });
  return apiFetch<FinanceDashboardDto>(`/finance/dashboard?${query.toString()}`);
}

export function staffDebtors(termId: string): Promise<DebtorDto[]> {
  const query = new URLSearchParams({ termId });
  return apiFetch<DebtorDto[]>(`/finance/debtors?${query.toString()}`);
}
