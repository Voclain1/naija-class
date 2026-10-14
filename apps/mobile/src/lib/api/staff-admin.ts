import type { AdminDashboardDto, SchoolPlanDto, SetupStateDto } from "@school-kit/types";

import { apiFetch } from "./client";

// CP4a — the owner/admin school overview.
//
// The same endpoint the website dashboard reads, so the phone and the website
// can never disagree about how many students are enrolled or what share of
// fees has come in: one query, two renderers. `termId` is REQUIRED server-side
// (adminDashboardQuerySchema), so the screen resolves the current term first
// through the CP3 term-context hook, exactly as the bursar screens do.

export function staffAdminDashboard(termId: string): Promise<AdminDashboardDto> {
  const params = new URLSearchParams({ termId });
  return apiFetch<AdminDashboardDto>(`/dashboard?${params.toString()}`);
}

/**
 * The setup checklist the website dashboard reads (owner/admin; the service
 * refuses anyone else). The app shows its progress and sends each step to the
 * website, where setup is done.
 */
export function staffSetupState(): Promise<SetupStateDto> {
  return apiFetch<SetupStateDto>("/schools/me/setup-state");
}

/** The school's plan and its student count against the cap (owner/admin). */
export function staffSchoolPlan(): Promise<SchoolPlanDto> {
  return apiFetch<SchoolPlanDto>("/schools/me/plan");
}
