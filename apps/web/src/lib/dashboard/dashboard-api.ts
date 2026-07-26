import type { AdminDashboardDto } from "@school-kit/types";

import { apiFetch } from "../api-client";

export function getAdminDashboard(termId: string): Promise<AdminDashboardDto> {
  return apiFetch<AdminDashboardDto>(`/dashboard?termId=${encodeURIComponent(termId)}`, {
    method: "GET",
  });
}
