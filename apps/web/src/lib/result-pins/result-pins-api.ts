import type {
  GenerateResultPinBatchInput,
  GeneratedResultPinBatchDto,
  ResultPinBatchListResponse,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// Result Checker PINs (Phase 8c / CP6b, docs/modules/phase-8.md §21.3).
// Owner/admin. Generating returns the only copy of the PINs that will exist.

export function listResultPinBatches(): Promise<ResultPinBatchListResponse> {
  return apiFetch<ResultPinBatchListResponse>("/result-pins/batches");
}

export function generateResultPinBatch(input: GenerateResultPinBatchInput): Promise<GeneratedResultPinBatchDto> {
  return apiFetch<GeneratedResultPinBatchDto>("/result-pins/batches", { method: "POST", body: input });
}

export function voidResultPinBatch(batchId: string): Promise<{ voided: true }> {
  return apiFetch<{ voided: true }>(`/result-pins/batches/${batchId}/void`, { method: "POST" });
}

export function voidResultPin(serial: string): Promise<{ voided: true }> {
  return apiFetch<{ voided: true }>("/result-pins/void", { method: "POST", body: { serial } });
}
