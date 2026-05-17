// Typed wrappers around the Slice 7 users endpoints. Shapes come from
// @school-kit/types so the client cannot drift from the server contract.

import type {
  InviteAdminInput,
  InviteAdminResponse,
  PendingInvitationDto,
  UserListItemDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listUsers(): Promise<UserListItemDto[]> {
  return apiFetch<UserListItemDto[]>("/users", { method: "GET" });
}

export function listPendingInvitations(): Promise<PendingInvitationDto[]> {
  return apiFetch<PendingInvitationDto[]>("/users/invitations", { method: "GET" });
}

export function inviteAdmin(input: InviteAdminInput): Promise<InviteAdminResponse> {
  return apiFetch<InviteAdminResponse>("/users/invite", {
    method: "POST",
    body: input,
  });
}
