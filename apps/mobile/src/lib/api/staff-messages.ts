import type { MessageGuardianOptionDto, MessageRecipient, OfficeStartMessageInput, StaffMessageListDto, StaffMessageThreadDto, StaffMessageThreadSummaryDto } from "@school-kit/types";

import { apiFetch } from "./client";

// Phase 9 / CP8.1 — parents' messages addressed or passed to this member of
// staff (docs/modules/phase-9.md §17.8). messages.read / messages.reply; the
// service shows each person only their own conversations.

const id = (value: string) => encodeURIComponent(value);

export type StaffMessageBox = "OPEN" | "CLOSED" | "FLAGGED";

export function staffMessages(box: StaffMessageBox): Promise<StaffMessageListDto> {
  return apiFetch<StaffMessageListDto>(`/messages?box=${box}`);
}

export function staffMessageThread(threadId: string): Promise<StaffMessageThreadDto> {
  return apiFetch<StaffMessageThreadDto>(`/messages/${id(threadId)}`);
}

export function staffReplyMessage(threadId: string, body: string, imageIds: string[] = []): Promise<StaffMessageThreadDto> {
  return apiFetch<StaffMessageThreadDto>(`/messages/${id(threadId)}/reply`, { method: "POST", body: { body, imageIds } });
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

// CP8.2 — flag for the owner and admins; and (messages.oversee) clear a flag.
export function staffFlagMessage(threadId: string, note: string): Promise<StaffMessageThreadDto> {
  return apiFetch<StaffMessageThreadDto>(`/messages/${id(threadId)}/flag`, { method: "POST", body: note ? { note } : {} });
}

export function staffClearMessageFlag(threadId: string): Promise<StaffMessageThreadSummaryDto> {
  return apiFetch<StaffMessageThreadSummaryDto>(`/messages/${id(threadId)}/clear-flag`, { method: "POST", body: {} });
}

// Phase 9 / CP11.1 — the school office writes to a parent first, as on the
// website (messages.start; docs/modules/phase-9.md §20). Search needs two
// letters; the reply is the new conversation.
export function staffSearchMessageGuardians(q: string): Promise<MessageGuardianOptionDto[]> {
  return apiFetch<MessageGuardianOptionDto[]>(`/messages/guardians?q=${encodeURIComponent(q)}`);
}

export function staffStartMessage(input: OfficeStartMessageInput): Promise<StaffMessageThreadDto> {
  return apiFetch<StaffMessageThreadDto>("/messages", { method: "POST", body: input });
}
