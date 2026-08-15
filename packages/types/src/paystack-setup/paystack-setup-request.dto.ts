export type PaystackSetupStatus = "PENDING" | "FULFILLED" | "REJECTED";

// GET /schools/me/paystack-setup-request (and the POST's response).
//
// Deliberately does NOT echo back the banking fields the school submitted.
// The school already knows what it typed, and re-serving an account number on
// every settings-page load would put it in browser memory and server logs on
// every visit for no benefit — the same reasoning that keeps those fields out
// of the platform-admin list (see CLAUDE.md's inventory row for
// platform_admin_list_paystack_setup_requests). If a school needs to correct
// a detail, it submits a new request; it does not edit this one.
//
// Null from the GET means "never submitted" — the settings page shows the
// form. Non-null means show the submitted state instead.
export interface PaystackSetupRequestDto {
  id: string;
  status: PaystackSetupStatus;
  businessName: string;
  submittedAt: string;
  fulfilledAt: string | null;
  // Set when the operator fulfils the request — the ACCT_ code issued for
  // this school. Surfacing it here means a school that loses the email can
  // still find its code in-app instead of asking for it again.
  subaccountCode: string | null;
  // Operator's note, surfaced only on REJECTED so a school knows what to fix
  // (wrong account number, name mismatch at the bank). Null otherwise.
  notes: string | null;
}
