// The line under every online Pay button, on the portal and in the parent app
// (2026-10-21). Every school's payment runs through SchoolKit's one Paystack
// account, so the parent's statement and Paystack's own screens name
// SchoolKit, not the school; this says so before they pay, so nobody rings
// the school asking who SchoolKit is. One string, so the two apps never drift.
export const ONLINE_PAYMENT_NOTE =
  "Paid securely through Paystack. Your bank statement may show SchoolKit, which your school uses for online fees.";
