// Typed wrapper around GET /schools/me/plan (docs/modules/plans.md).

import type { SchoolPlanDto } from "@school-kit/types";

import { apiFetch } from "../api-client";

export function getSchoolPlan(): Promise<SchoolPlanDto> {
  return apiFetch<SchoolPlanDto>("/schools/me/plan", { method: "GET" });
}
