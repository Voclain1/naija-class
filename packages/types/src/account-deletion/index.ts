// Account deletion requests (2026-10-24, docs/modules/account-deletion-requests.md).
//
// The app stores require a way to ask for an account to be deleted from
// inside the app. The school holds the records, so deleting is the school's
// call: a request only tells the school, which then removes the account with
// the tools it already has, and marks the request handled.

export const ACCOUNT_DELETION_PRINCIPALS = ["STAFF", "GUARDIAN", "STUDENT"] as const;
export type AccountDeletionPrincipal = (typeof ACCOUNT_DELETION_PRINCIPALS)[number];

export const ACCOUNT_DELETION_PRINCIPAL_LABELS: Record<AccountDeletionPrincipal, string> = {
  STAFF: "Staff member",
  GUARDIAN: "Parent or guardian",
  STUDENT: "Student",
};

/**
 * POST /users/me/deletion-request, /portal/me/deletion-request and
 * /student-portal/me/deletion-request (and GET of each): the person's own
 * open request. Asking twice changes nothing.
 */
export interface MyAccountDeletionRequestDto {
  /** Null: no open request. */
  requestedAt: string | null;
}

// GET /account-deletion-requests (owner and admin, user.deactivate).
export interface AccountDeletionRequestDto {
  id: string;
  principal: AccountDeletionPrincipal;
  subjectId: string;
  /** The person's name, or null if their record is already gone. */
  name: string | null;
  requestedAt: string;
}
