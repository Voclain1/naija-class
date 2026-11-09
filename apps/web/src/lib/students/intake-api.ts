import type { PrepareStudentIntakeInput, StudentIntakeProposalDto } from "@school-kit/types";
import { apiFetch } from "@/lib/api-client";

const base = "/student-intake";
export const intakeApi = {
  availability: () => apiFetch<{ enabled: boolean }>(`${base}/availability`),
  prepare: (input: PrepareStudentIntakeInput) => apiFetch<StudentIntakeProposalDto>(`${base}/proposals`, { method: "POST", body: input }),
  get: (id: string) => apiFetch<StudentIntakeProposalDto>(`${base}/proposals/${encodeURIComponent(id)}`),
  confirm: (id: string, previewHash: string) => apiFetch<StudentIntakeProposalDto>(`${base}/proposals/${encodeURIComponent(id)}/confirm`, { method: "POST", body: { previewHash } }),
  refresh: (id: string, clientRequestId: string) => apiFetch<StudentIntakeProposalDto>(`${base}/proposals/${encodeURIComponent(id)}/refresh`, { method: "POST", body: { clientRequestId } }),
};
