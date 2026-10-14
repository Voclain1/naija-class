import type {
  GenerateResultPinBatchInput,
  GeneratedResultPinBatchDto,
  ResultPinBatchListResponse,
} from "@school-kit/types";

import { apiFetch } from "./client";

// Result Checker PINs (docs/modules/phase-8.md §21.3), the endpoints the
// website's /report-cards/pins uses. Owner/admin: the permission on the
// controller, the role re-checked in the service.
//
// Generating returns the ONLY copy of the PINs that will ever exist (D16).
// The screen holds them in memory until they are shared or printed; they are
// never put in the query cache, which is why generate is not a query.

export function staffResultPinBatches(): Promise<ResultPinBatchListResponse> {
  return apiFetch<ResultPinBatchListResponse>("/result-pins/batches");
}

export function staffGenerateResultPins(input: GenerateResultPinBatchInput): Promise<GeneratedResultPinBatchDto> {
  return apiFetch<GeneratedResultPinBatchDto>("/result-pins/batches", { method: "POST", body: input });
}

export function staffVoidResultPinBatch(batchId: string): Promise<{ voided: true }> {
  return apiFetch<{ voided: true }>(`/result-pins/batches/${encodeURIComponent(batchId)}/void`, { method: "POST" });
}

export function staffVoidResultPin(serial: string): Promise<{ voided: true }> {
  return apiFetch<{ voided: true }>("/result-pins/void", { method: "POST", body: { serial } });
}
