import type { PrepareStudentCorrectionsInput, StudentCorrectionProposalDto } from "@school-kit/types";
import { apiFetch } from "@/lib/api-client";
const base = "/student-corrections";
const path = (id: string) => `${base}/proposals/${encodeURIComponent(id)}`;
export const correctionsApi = {
  available: () => apiFetch<{ enabled: boolean }>(`${base}/availability`),
  prepare: (body: PrepareStudentCorrectionsInput) => apiFetch<StudentCorrectionProposalDto>(`${base}/proposals`, { method: "POST", body }),
  get: (id: string) => apiFetch<StudentCorrectionProposalDto>(path(id)),
  confirm: (id: string, previewHash: string) => apiFetch<StudentCorrectionProposalDto>(`${path(id)}/confirm`, { method: "POST", body: { previewHash } }),
  refresh: (id: string, clientRequestId: string) => apiFetch<StudentCorrectionProposalDto>(`${path(id)}/refresh`, { method: "POST", body: { clientRequestId } }),
};
