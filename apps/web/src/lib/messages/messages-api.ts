import type {
  MessageGuardianOptionDto,
  MessageRecipient,
  MessagingStaffDto,
  OfficeStartMessageInput,
  SetMessagingRolesInput,
  StaffMessageListDto,
  StaffMessageThreadDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// Phase 9 / CP8.1 — the school's side of messaging (docs/modules/phase-9.md §17.8).

const id = (value: string) => encodeURIComponent(value);

export const listMessages = (box: "OPEN" | "CLOSED") => apiFetch<StaffMessageListDto>(`/messages?box=${box}`, { method: "GET" });
export const getMessageThread = (threadId: string) => apiFetch<StaffMessageThreadDto>(`/messages/${id(threadId)}`, { method: "GET" });
export const replyToThread = (threadId: string, body: string) =>
  apiFetch<StaffMessageThreadDto>(`/messages/${id(threadId)}/reply`, { method: "POST", body: { body } });
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
