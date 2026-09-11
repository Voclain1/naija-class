import { z } from "zod";

// The school's own bank account, for parents who would rather transfer
// directly than pay through Paystack.
//
// Plan-first: docs/modules/school-bank-details.md
//
// NOT the guarded Paystack payout account. `PaystackSetupRequest.accountNumber`
// is the operator-facing account used to create the subaccount, deliberately
// kept out of list surfaces and behind an individually-audited reveal. This is
// a separate, school-owned field that exists to be SHOWN. The two are often
// the same digits and are never the same thing.

/** NUBAN account numbers are exactly ten digits. */
export const NUBAN_PATTERN = /^\d{10}$/;

export const bankAccountNumberSchema = z
  .string()
  .trim()
  .regex(NUBAN_PATTERN, "Account number must be exactly 10 digits");

/**
 * What a school has filled in. Any field may be absent — most schools will
 * never set these.
 */
export interface SchoolBankDetailsInput {
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankDetailsEnabled: boolean;
}

/** The shape a surface renders once it is safe to show. */
export interface SchoolBankDetails {
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
}

/**
 * Resolve whether a school's bank details may be shown, and return them if so.
 *
 * THE TOGGLE ALONE IS NOT ENOUGH. Display requires `bankDetailsEnabled` AND
 * all three text fields present:
 *
 *   - Without the toggle, "visible once filled" means a half-finished form
 *     shows a wrong or partial account number to parents the moment someone
 *     saves.
 *   - Without the completeness check, a school that enables it and later
 *     blanks one field renders a partial "pay to:" block — an account number
 *     with no bank, or a bank with no number, either of which is worse than
 *     showing nothing.
 *
 * ONE helper, because three surfaces depend on this answer — the finance
 * dashboard, the settings preview, and the WhatsApp share message. Three
 * independent `if (enabled && ...)` checks would eventually disagree, and the
 * way they'd disagree is by one of them showing an incomplete account.
 *
 * Returns null rather than a partial object so a caller cannot accidentally
 * render an empty string where an account number belongs.
 */
export function resolveSchoolBankDetails(
  input: SchoolBankDetailsInput | null | undefined,
): SchoolBankDetails | null {
  if (!input || !input.bankDetailsEnabled) return null;

  const bankName = input.bankName?.trim();
  const bankAccountName = input.bankAccountName?.trim();
  const bankAccountNumber = input.bankAccountNumber?.trim();

  if (!bankName || !bankAccountName || !bankAccountNumber) return null;

  return { bankName, bankAccountName, bankAccountNumber };
}
