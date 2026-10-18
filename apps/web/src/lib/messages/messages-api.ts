import type {
  MessageGuardianOptionDto,
  MessageRecipient,
  MessagingStaffDto,
  OfficeStartMessageInput,
  SetMessagingRolesInput,
  StagedMessageImageDto,
  StaffMessageListDto,
  StaffMessageThreadDto,
  StaffMessageThreadSummaryDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// Phase 9 / CP8.1 — the school's side of messaging (docs/modules/phase-9.md §17.8).

const id = (value: string) => encodeURIComponent(value);

export type MessageBox = "OPEN" | "CLOSED" | "FLAGGED";

export const listMessages = (box: MessageBox) => apiFetch<StaffMessageListDto>(`/messages?box=${box}`, { method: "GET" });
export const getMessageThread = (threadId: string) => apiFetch<StaffMessageThreadDto>(`/messages/${id(threadId)}`, { method: "GET" });
export const replyToThread = (threadId: string, body: string, imageIds: string[] = []) =>
  apiFetch<StaffMessageThreadDto>(`/messages/${id(threadId)}/reply`, { method: "POST", body: { body, imageIds } });

// CP8.2 — one photo a request (multipart; the browser sets the boundary), named on the reply.
export function stageMessageImage(file: File): Promise<StagedMessageImageDto> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<StagedMessageImageDto>("/messages/images", { method: "POST", body: form });
}
export const flagThread = (threadId: string, note: string) =>
  apiFetch<StaffMessageThreadDto>(`/messages/${id(threadId)}/flag`, { method: "POST", body: note ? { note } : {} });
export const clearThreadFlag = (threadId: string) =>
  apiFetch<StaffMessageThreadSummaryDto>(`/messages/${id(threadId)}/clear-flag`, { method: "POST" });
export const passThread = (threadId: string, recipient: MessageRecipient) =>
  apiFetch<StaffMessageThreadDto>(`/messages/${id(threadId)}/pass`, { method: "POST", body: { recipient } });
export const markThreadHandled = (threadId: string, handled: boolean) =>
  apiFetch<StaffMessageThreadDto>(`/messages/${id(threadId)}/handled`, { method: "POST", body: { handled } });
export const closeThread = (threadId: string) => apiFetch<StaffMessageThreadDto>(`/messages/${id(threadId)}/close`, { method: "POST" });

export const searchMessageGuardians = (q: string) =>
  apiFetch<MessageGuardianOptionDto[]>(`/messages/guardians?${new URLSearchParams({ q })}`, { method: "GET" });
export const officeStartThread = (body: OfficeStartMessageInput) => apiFetch<StaffMessageThreadDto>("/messages", { method: "POST", body });

export const getMessagingStaff = () => apiFetch<MessagingStaffDto[]>("/messages/settings/staff", { method: "GET" });
export const setMessagingRoles = (body: SetMessagingRolesInput) =>
  apiFetch<MessagingStaffDto[]>("/messages/settings/staff", { method: "PUT", body });
