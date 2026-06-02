// Typed wrappers around the Phase 2 / Slice 1 grading endpoints. Same shape as
// academic-years-api.ts — the API returns the DTO directly (no { data } wrap).

import type {
  CreateGradingComponentInput,
  GradeBoundaryDto,
  GradingComponentDto,
  GradingSchemeDto,
  ReplaceGradeBoundariesInput,
  ReplaceGradingComponentsInput,
  UpdateGradeBoundaryInput,
  UpdateGradingComponentInput,
  UpdateGradingSchemeInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// ---------- scheme + components ----------

export function getGradingScheme(): Promise<GradingSchemeDto> {
  return apiFetch<GradingSchemeDto>("/grading-scheme", { method: "GET" });
}

export function updateGradingScheme(
  input: UpdateGradingSchemeInput,
): Promise<GradingSchemeDto> {
  return apiFetch<GradingSchemeDto>("/grading-scheme", {
    method: "PATCH",
    body: input,
  });
}

export function listComponents(): Promise<GradingComponentDto[]> {
  return apiFetch<GradingComponentDto[]>("/grading-scheme/components", {
    method: "GET",
  });
}

export function createComponent(
  input: CreateGradingComponentInput,
): Promise<GradingComponentDto> {
  return apiFetch<GradingComponentDto>("/grading-scheme/components", {
    method: "POST",
    body: input,
  });
}

export function updateComponent(
  id: string,
  input: UpdateGradingComponentInput,
): Promise<GradingComponentDto> {
  return apiFetch<GradingComponentDto>(`/grading-scheme/components/${id}`, {
    method: "PATCH",
    body: input,
  });
}

export function deleteComponent(id: string): Promise<void> {
  return apiFetch<void>(`/grading-scheme/components/${id}`, { method: "DELETE" });
}

// Bulk replace — the settings UI save path (sum-to-100 over the whole set).
export function replaceComponents(
  input: ReplaceGradingComponentsInput,
): Promise<GradingSchemeDto> {
  return apiFetch<GradingSchemeDto>("/grading-scheme/components", {
    method: "PUT",
    body: input,
  });
}

// ---------- boundaries ----------

export function listBoundaries(): Promise<GradeBoundaryDto[]> {
  return apiFetch<GradeBoundaryDto[]>("/grade-boundaries", { method: "GET" });
}

export function updateBoundary(
  id: string,
  input: UpdateGradeBoundaryInput,
): Promise<GradeBoundaryDto> {
  return apiFetch<GradeBoundaryDto>(`/grade-boundaries/${id}`, {
    method: "PATCH",
    body: input,
  });
}

// Bulk replace — the settings UI save path (ranges tile 0..100).
export function replaceBoundaries(
  input: ReplaceGradeBoundariesInput,
): Promise<GradeBoundaryDto[]> {
  return apiFetch<GradeBoundaryDto[]>("/grade-boundaries", {
    method: "PUT",
    body: input,
  });
}
