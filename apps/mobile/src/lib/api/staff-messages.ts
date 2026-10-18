import type { MessageRecipient, StaffMessageListDto, StaffMessageThreadDto } from "@school-kit/types";

import { apiFetch } from "./client";

// Phase 9 / CP8.1 — parents' messages addressed or passed to this member of
// staff (docs/modules/phase-9.md §17.8). messages.read / messages.reply; the
// service shows each person only their own conversations.

const id = (value: string) => encodeURIComponent(value);

export function staffMessages(box: "OPEN" | "CLOSED"): Promise<StaffMessageListDto> {
  return apiFetch<StaffMessageListDto>(`/messages?box=${box}`);
}

export function staffMessageThread(threadId: string): Promise<StaffMessageThreadDto> {
  return apiFetch<StaffMessageThreadDto>(`/messages/${id(threadId)}`);
}

export function staffReplyMessage(threadId: string, body: string): Promise<StaffMessageThreadDto> {
  return apiFetch<StaffMessageThreadDto>(`/messages/${id(threadId)}/reply`, { method: "POST", body: { body } });
}

export function staffPassMessage(threadId: string, recipient: MessageRecipient): Promise<StaffMessageThreadDto> {
  return apiFetch<StaffMessageThreadDto>(`/messages/${id(threadId)}/pass`, { method: "POST", body: { recipient } });
}

export function staffMarkHandled(threadId: string, handled: boolean): Promise<StaffMessageThreadDto> {
  return apiFetch<StaffMessageThreadDto>(`/messages/${id(threadId)}/handled`, { method: "POST", body: { handled } });
}

export function staffCloseMessage(threadId: string): Promise<StaffMessageThreadDto> {
  return apiFetch<StaffMessageThreadDto>(`/messages/${id(threadId)}/close`, { method: "POST", body: {} });
}
