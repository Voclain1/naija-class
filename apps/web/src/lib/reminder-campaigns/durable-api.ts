import type { PrepareReminderCampaignInput, ReminderCampaignDto, ReminderCampaignProposalDto } from "@school-kit/types";
import { apiFetch } from "@/lib/api-client";
const base = "/finance/reminder-campaigns";
const proposal = (id: string) => `${base}/proposals/${encodeURIComponent(id)}`;
export const durableCampaignApi = {
  available: () => apiFetch<{ enabled: boolean }>(`${base}/availability`),
  prepare: (body: PrepareReminderCampaignInput) => apiFetch<ReminderCampaignProposalDto>(`${base}/proposals`, { method: "POST", body }),
  proposal: (id: string) => apiFetch<ReminderCampaignProposalDto>(proposal(id)),
  confirm: (id: string, previewHash: string) => apiFetch<ReminderCampaignDto>(`${proposal(id)}/confirm`, { method: "POST", body: { previewHash } }),
  refresh: (id: string, clientRequestId: string) => apiFetch<ReminderCampaignProposalDto>(`${proposal(id)}/refresh`, { method: "POST", body: { clientRequestId } }),
  campaign: (id: string) => apiFetch<ReminderCampaignDto>(`${base}/${encodeURIComponent(id)}`),
  halt: (id: string) => apiFetch<ReminderCampaignDto>(`${base}/${encodeURIComponent(id)}/halt`, { method: "POST" }),
  resume: (id: string) => apiFetch<ReminderCampaignDto>(`${base}/${encodeURIComponent(id)}/resume`, { method: "POST" }),
};
