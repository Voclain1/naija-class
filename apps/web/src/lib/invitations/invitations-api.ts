// Typed wrappers around the public invitation endpoints.
//
// getInvitation is a plain read — apiFetch straight to NestJS, no session
// implications. acceptInvitation mints a real session (same shape as
// login/signup: { user, school, token }), so — like login/signup/logout/
// 2fa-challenge — it MUST go through a Next.js proxy route that sets the
// sk_session HttpOnly cookie, not plain apiFetch direct to NestJS. Calling
// NestJS directly here was the root cause of a ~4-week-old e2e hang: no
// cookie meant AcceptInvitationForm's post-accept hard navigation to
// /dashboard had nothing to authenticate with, so middleware.ts bounced it
// straight back to /login every single time (see docs/deferred.md).

import type {
  AcceptInvitationInput,
  AcceptInvitationResponse,
  PublicInvitationDto,
} from "@school-kit/types";

import { apiFetch, proxyFetch } from "../api-client";

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
  return proxyFetch<AcceptInvitationResponse>(
    `/api/invitations/${encodeURIComponent(token)}/accept`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}
