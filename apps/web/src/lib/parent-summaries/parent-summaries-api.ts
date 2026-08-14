// Typed wrappers around /parent-summaries. Shapes come from @school-kit/types
// so the client can't drift from the API.

import type {
  ParentSummaryRowDto,
  ParentSummarySettingsDto,
  UpdateParentSummarySettingsInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function getParentSummarySettings(): Promise<ParentSummarySettingsDto> {
  return apiFetch<ParentSummarySettingsDto>("/parent-summaries/settings", {
    method: "GET",
  });
}

export function updateParentSummarySettings(
  input: UpdateParentSummarySettingsInput,
): Promise<ParentSummarySettingsDto> {
  return apiFetch<ParentSummarySettingsDto>("/parent-summaries/settings", {
    method: "PATCH",
    body: input,
  });
}

// The most recent notes across the school. The settings screen shows these
// under the toggle deliberately: with no approval gate (phase-5.md D16), this
// list is the only way an admin can see what is actually being sent to
// parents in their school's name.
export function listParentSummaries(limit = 5): Promise<ParentSummaryRowDto[]> {
  return apiFetch<ParentSummaryRowDto[]>(`/parent-summaries?limit=${limit}`, {
    method: "GET",
  });
}

export function runParentSummariesNow(): Promise<{ queued: number }> {
  return apiFetch<{ queued: number }>("/parent-summaries/run", { method: "POST" });
}
