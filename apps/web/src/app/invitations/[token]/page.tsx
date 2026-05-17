"use client";

import { useEffect, useState } from "react";
import { use } from "react";

import type { PublicInvitationDto } from "@school-kit/types";

import { BrandLoadingScreen } from "@/components/brand-loading-screen";
import { AcceptInvitationForm } from "@/components/invitations/accept-invitation-form";
import { InvitationErrorCard } from "@/components/invitations/invitation-error-card";
import { ApiError } from "@/lib/api-client";
import { getInvitation } from "@/lib/invitations/invitations-api";

// Bare route (not in (auth) or (admin) groups). Reachable WITHOUT auth, so
// the user clicking from email lands here regardless of session state.
//
// Three render states:
//   - "loading"  → branded loading screen
//   - "error"    → one of three friendly cards (expired / accepted / not-found)
//   - "ready"    → AcceptInvitationForm
//
// Centred-card layout matches the (auth) shell visually without inheriting
// the layout itself — the (auth) layout has a School Kit headline; for
// invitations we'd rather lead with the school's name in the form's title.

type State =
  | { status: "loading" }
  | { status: "error"; variant: "expired" | "accepted" | "notFound" }
  | { status: "ready"; invitation: PublicInvitationDto };

interface Props {
  params: Promise<{ token: string }>;
}

export default function InvitationAcceptPage({ params }: Props) {
  // Next.js 15: route params are a Promise; use `use()` to unwrap them in
  // a client component (Next surfaces a hard warning if you read .token
  // directly on the Promise).
  const { token } = use(params);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getInvitation(token)
      .then((invitation) => {
        if (!cancelled) setState({ status: "ready", invitation });
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError) {
          if (error.code === "INVITATION_EXPIRED") {
            setState({ status: "error", variant: "expired" });
          } else if (error.code === "INVITATION_ALREADY_ACCEPTED") {
            setState({ status: "error", variant: "accepted" });
          } else {
            setState({ status: "error", variant: "notFound" });
          }
        } else {
          setState({ status: "error", variant: "notFound" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
      {state.status === "loading" && <BrandLoadingScreen />}
      {state.status === "error" && <InvitationErrorCard variant={state.variant} />}
      {state.status === "ready" && (
        <AcceptInvitationForm token={token} invitation={state.invitation} />
      )}
    </div>
  );
}
