import type {
  CreateDiscountRuleInput,
  DiscountRuleDto,
  UpdateDiscountRuleInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listDiscountRules(options: {
  studentId?: string;
  feeItemId?: string;
  feeCategoryId?: string;
  includeInactive?: boolean;
} = {}): Promise<DiscountRuleDto[]> {
  const params = new URLSearchParams();
  if (options.studentId) params.set("studentId", options.studentId);
  if (options.feeItemId) params.set("feeItemId", options.feeItemId);
  if (options.feeCategoryId) params.set("feeCategoryId", options.feeCategoryId);
  if (options.includeInactive) params.set("includeInactive", "true");
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<DiscountRuleDto[]>(`/discount-rules${qs}`, { method: "GET" });
}

export function getDiscountRule(id: string): Promise<DiscountRuleDto> {
  return apiFetch<DiscountRuleDto>(`/discount-rules/${id}`, { method: "GET" });
}

export function createDiscountRule(
  input: CreateDiscountRuleInput,
): Promise<DiscountRuleDto> {
  return apiFetch<DiscountRuleDto>("/discount-rules", { method: "POST", body: input });
}

export function updateDiscountRule(
  id: string,
  input: UpdateDiscountRuleInput,
): Promise<DiscountRuleDto> {
  return apiFetch<DiscountRuleDto>(`/discount-rules/${id}`, { method: "PATCH", body: input });
}

export function deactivateDiscountRule(id: string): Promise<void> {
  return apiFetch<void>(`/discount-rules/${id}`, { method: "DELETE" });
}
