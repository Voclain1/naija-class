import type {
  AssistantTurnDto,
  AssistantTurnInput,
  AssistantCapabilitiesDto,
  AssistantHelpHitDto,
  BillingContextDto,
  BillingRunDto,
  BillingRunInput,
  PrepareStudentCorrectionsInput,
  StudentCorrectionProposalDto,
} from "@school-kit/types";
import { apiFetch } from "@/lib/api-client";

// The assistant's own endpoints, and the existing workflow APIs it drives.
// Request text goes only to /help and /turn, in a POST body (never a URL).
export const assistantApi = {
  capabilities: () => apiFetch<AssistantCapabilitiesDto>("/assistant/workspace/capabilities"),
  help: (question: string) => apiFetch<{ hits: AssistantHelpHitDto[] }>("/assistant/workspace/help", { method: "POST", body: { question } }),
  /** One model-backed turn (docs/modules/assistant-workspace.md, "Model orchestration"). POST body only. */
  turn: (input: AssistantTurnInput) => apiFetch<AssistantTurnDto>("/assistant/workspace/turn", { method: "POST", body: input }),
};

const billing = "/assistant/billing";
export const invoiceRunApi = {
  context: () => apiFetch<BillingContextDto>(`${billing}/context`),
  prepare: (input: BillingRunInput) => apiFetch<BillingRunDto>(`${billing}/runs`, { method: "POST", body: input }),
  get: (id: string) => apiFetch<BillingRunDto>(`${billing}/runs/${encodeURIComponent(id)}`),
  approve: (id: string, previewHash: string) => apiFetch<BillingRunDto>(`${billing}/runs/${encodeURIComponent(id)}/approve`, { method: "POST", body: { previewHash } }),
};

const corrections = "/student-corrections/proposals";
export const correctionApi = {
  prepare: (input: PrepareStudentCorrectionsInput) => apiFetch<StudentCorrectionProposalDto>(corrections, { method: "POST", body: input }),
  get: (id: string) => apiFetch<StudentCorrectionProposalDto>(`${corrections}/${encodeURIComponent(id)}`),
  confirm: (id: string, previewHash: string) => apiFetch<StudentCorrectionProposalDto>(`${corrections}/${encodeURIComponent(id)}/confirm`, { method: "POST", body: { previewHash } }),
  refresh: (id: string, clientRequestId: string) => apiFetch<StudentCorrectionProposalDto>(`${corrections}/${encodeURIComponent(id)}/refresh`, { method: "POST", body: { clientRequestId } }),
};
