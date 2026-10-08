// Typed wrappers around the Slice 7 users endpoints. Shapes come from
// @school-kit/types so the client cannot drift from the server contract.

import type {
  InviteAdminInput,
  InviteAdminResponse,
  PendingInvitationDto,
  ResendStaffInvitationResponse,
  RevokeStaffInvitationResponse,
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

// Ends the invitation and issues a fresh link for the same person and role.
export function resendInvitation(id: string): Promise<ResendStaffInvitationResponse> {
  return apiFetch<ResendStaffInvitationResponse>(`/users/invitations/${encodeURIComponent(id)}/resend`, {
    method: "POST",
  });
}

// Ends a pending invitation: the link already sent stops working.
export function revokeInvitation(id: string): Promise<RevokeStaffInvitationResponse> {
  return apiFetch<RevokeStaffInvitationResponse>(`/users/invitations/${encodeURIComponent(id)}/revoke`, {
    method: "POST",
  });
}
