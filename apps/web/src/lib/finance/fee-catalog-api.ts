import type {
  CreateFeeCategoryInput,
  CreateFeeItemInput,
  FeeCategoryDto,
  FeeItemDto,
  UpdateFeeCategoryInput,
  UpdateFeeItemInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// ── fee categories ──────────────────────────────────────────────────────────

export function listFeeCategories(
  options: { includeInactive?: boolean } = {},
): Promise<FeeCategoryDto[]> {
  const qs = options.includeInactive ? "?includeInactive=true" : "";
  return apiFetch<FeeCategoryDto[]>(`/fee-categories${qs}`, { method: "GET" });
}

export function getFeeCategory(id: string): Promise<FeeCategoryDto> {
  return apiFetch<FeeCategoryDto>(`/fee-categories/${id}`, { method: "GET" });
}

export function createFeeCategory(
  input: CreateFeeCategoryInput,
): Promise<FeeCategoryDto> {
  return apiFetch<FeeCategoryDto>("/fee-categories", { method: "POST", body: input });
}

export function updateFeeCategory(
  id: string,
  input: UpdateFeeCategoryInput,
): Promise<FeeCategoryDto> {
  return apiFetch<FeeCategoryDto>(`/fee-categories/${id}`, { method: "PATCH", body: input });
}

export function deleteFeeCategory(id: string): Promise<void> {
  return apiFetch<void>(`/fee-categories/${id}`, { method: "DELETE" });
}

// ── fee items ───────────────────────────────────────────────────────────────

export function listFeeItems(options: {
  categoryId?: string;
  includeInactive?: boolean;
} = {}): Promise<FeeItemDto[]> {
  const params = new URLSearchParams();
  if (options.categoryId) params.set("categoryId", options.categoryId);
  if (options.includeInactive) params.set("includeInactive", "true");
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<FeeItemDto[]>(`/fee-items${qs}`, { method: "GET" });
}

export function createFeeItem(input: CreateFeeItemInput): Promise<FeeItemDto> {
  return apiFetch<FeeItemDto>("/fee-items", { method: "POST", body: input });
}

export function updateFeeItem(
  id: string,
  input: UpdateFeeItemInput,
): Promise<FeeItemDto> {
  return apiFetch<FeeItemDto>(`/fee-items/${id}`, { method: "PATCH", body: input });
}

export function deleteFeeItem(id: string): Promise<void> {
  return apiFetch<void>(`/fee-items/${id}`, { method: "DELETE" });
}
