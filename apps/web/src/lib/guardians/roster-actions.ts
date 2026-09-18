import type { GuardianPortalStatusDto } from "@school-kit/types";

// The guardian roster (/guardians) — which portal actions a row offers, and
// how its status reads. Pure, so the spec pins it (2026-09-16).
//
// The rule mirrors what the API will accept, so the roster never offers a
// button that can only fail:
//   NO_EMAIL    — nothing; the invite endpoint refuses GUARDIAN_HAS_NO_EMAIL.
//   NOT_INVITED — Invite.
//   EXPIRED     — Invite. An expired invitation does not block a fresh one,
//                 and Resend would do the same thing under a second name.
//   INVITED     — Resend and Cancel. A plain invite is refused while one is live.
//   ACTIVE      — nothing; invite and resend both refuse GUARDIAN_ALREADY_ACTIVE.
//                 An active parent changes a password through the portal's own
//                 Forgot password, never through a link staff can see.
export type RosterAction = "invite" | "resend" | "revoke";

export function rosterActions(status: GuardianPortalStatusDto): RosterAction[] {
  switch (status) {
    case "NOT_INVITED":
    case "EXPIRED":
      return ["invite"];
    case "INVITED":
      return ["resend", "revoke"];
    case "NO_EMAIL":
    case "ACTIVE":
      return [];
  }
}

export const PORTAL_STATUS_LABEL: Record<GuardianPortalStatusDto, string> = {
  ACTIVE: "Portal active",
  INVITED: "Invitation pending",
  EXPIRED: "Invitation expired",
  NOT_INVITED: "Not invited",
  NO_EMAIL: "No email",
};

// The filter options, in the order an admin works through them: the people
// who can be invited right now come first.
export const PORTAL_STATUS_FILTERS: Array<{ value: GuardianPortalStatusDto | "ALL"; label: string }> = [
  { value: "ALL", label: "All guardians" },
  { value: "NOT_INVITED", label: "Not invited" },
  { value: "EXPIRED", label: "Invitation expired" },
  { value: "INVITED", label: "Invitation pending" },
  { value: "ACTIVE", label: "Portal active" },
  { value: "NO_EMAIL", label: "No email" },
];
