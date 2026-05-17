// Typed wrappers around the public invitation endpoints. Both calls are
// public — apiFetch will still send the Authorization header if a token
// happens to be in localStorage (e.g. someone clicks an invite while
// already logged in), but the server endpoints don't require it.

import type {
  AcceptInvitationInput,
  AcceptInvitationResponse,
  PublicInvitationDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// notifyOnUnauthorized=false: a 401 here would never come from the public
// endpoint itself (it requires no auth) but defending against a future
// auth-gating mistake by NOT firing the global redirect keeps the user on
// the accept page instead of bouncing to /login mid-flow.
export function getInvitation(token: string): Promise<PublicInvitationDto> {
  return apiFetch<PublicInvitationDto>(`/invitations/${encodeURIComponent(token)}`, {
    method: "GET",
    notifyOnUnauthorized: false,
  });
}

export function acceptInvitation(
  token: string,
  input: AcceptInvitationInput,
): Promise<AcceptInvitationResponse> {
  return apiFetch<AcceptInvitationResponse>(
    `/invitations/${encodeURIComponent(token)}/accept`,
    {
      method: "POST",
      body: input,
      notifyOnUnauthorized: false,
    },
  );
}
