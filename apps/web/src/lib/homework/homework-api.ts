// Typed wrapper around /homework (docs/modules/the-school-day.md Part B).
// Shapes come from @school-kit/types so the client cannot drift from the API.

import type {
  CreateHomeworkInput,
  HomeworkDto,
  HomeworkListResponse,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listHomework(options: { classArmId?: string; all?: boolean } = {}): Promise<HomeworkListResponse> {
  const params = new URLSearchParams();
  if (options.classArmId) params.set("classArmId", options.classArmId);
  if (options.all) params.set("all", "true");
  const query = params.toString();
  return apiFetch<HomeworkListResponse>(`/homework${query ? `?${query}` : ""}`);
}

export function createHomework(input: CreateHomeworkInput): Promise<HomeworkDto> {
  return apiFetch<HomeworkDto>("/homework", { method: "POST", body: input });
}

export function withdrawHomework(id: string): Promise<HomeworkDto> {
  return apiFetch<HomeworkDto>(`/homework/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
}
