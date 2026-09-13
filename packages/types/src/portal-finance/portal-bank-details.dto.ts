// GET /portal/bank-details — the school's direct-transfer account, for the
// guardian portal's invoice view.
//
// Plan-first: docs/modules/school-bank-details.md (§10 records the scope
// change that brought the guardian portal in).
//
// ONLY THE RESOLVED VALUE EVER CROSSES THIS BOUNDARY. The admin-facing
// SchoolMeDto carries the raw four fields because admins edit them; a parent
// has no reason to hold a half-typed account number the school has not
// switched on. The API applies resolveSchoolBankDetails before responding,
// so "disabled" and "incomplete" both arrive as `null` — the stored digits
// never reach the parent's browser in either case, rather than reaching it
// and being hidden by the page.
//
// A separate endpoint rather than a field on PortalInvoiceListResponse: that
// response is shared with the student portal (StudentPortalService.listFees),
// and the account is a property of the school, not of one child's invoices.

import type { SchoolBankDetails } from "../finance/bank-details.js";

export interface PortalBankDetailsResponse {
  bankTransfer: SchoolBankDetails | null;
}
