import type {
  CreateHomeworkInput,
  HomeworkDto,
  HomeworkListResponse,
} from "@school-kit/types";

import { apiFetch } from "./client";

// Homework, staff side (docs/modules/the-school-day.md Part B).
//
// The list defaults to the caller's OWN — which is what a teacher wants and
// the only thing the server will give them. `all` exists for owner/admin and
// is refused for anyone else rather than quietly narrowed, so the phone does
// not offer it to a teacher.

export function staffHomework(classArmId?: string, all?: boolean): Promise<HomeworkListResponse> {
  const params = new URLSearchParams();
  if (classArmId) params.set("classArmId", classArmId);
  if (all) params.set("all", "true");
  const query = params.toString();
  return apiFetch<HomeworkListResponse>(`/homework${query ? `?${query}` : ""}`);
}

export function createStaffHomework(input: CreateHomeworkInput): Promise<HomeworkDto> {
  return apiFetch<HomeworkDto>("/homework", { method: "POST", body: input });
}

export function withdrawStaffHomework(id: string): Promise<HomeworkDto> {
  return apiFetch<HomeworkDto>(`/homework/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
}
