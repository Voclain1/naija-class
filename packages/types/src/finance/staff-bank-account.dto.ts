import { z } from "zod";

// NUBAN (Nigerian Uniform Bank Account Number) is always exactly 10 digits.
const accountNumberSchema = z.string().trim().regex(/^\d{10}$/, "Account number must be 10 digits");
const bankCodeSchema = z.string().trim().min(1, "Bank is required").max(10);

// POST /staff-bank-accounts/verify — resolves a bank code + account number to
// the bank's own record of the account holder's name, WITHOUT creating
// anything (no recipient, no DB row). The operator sees the resolved name and
// confirms it's correct before saving — CP4 plan-first D1's "verify" step.
export const verifyStaffBankAccountSchema = z.object({
  bankCode: bankCodeSchema,
  accountNumber: accountNumberSchema,
});
export type VerifyStaffBankAccountInput = z.infer<typeof verifyStaffBankAccountSchema>;

export interface VerifyBankAccountResultDto {
  accountName: string;
  bankCode: string;
  accountNumber: string;
}

// POST /staff-bank-accounts — accountName is the CLIENT-ECHOED value from the
// verify step, not trusted as-is: the service independently re-resolves the
// account server-side and compares, rejecting a mismatch (stale UI state, or
// account details changed between verify and save) rather than trusting
// whatever the client sends. "Saving without verification is not allowed" is
// enforced this way — there is no way to reach create() with a name the
// server hasn't independently confirmed matches the bank's own record.
export const createStaffBankAccountSchema = z.object({
  userId: z.string().uuid(),
  bankCode: bankCodeSchema,
  accountNumber: accountNumberSchema,
  accountName: z.string().trim().min(1).max(200),
});
export type CreateStaffBankAccountInput = z.infer<typeof createStaffBankAccountSchema>;

export interface StaffBankAccountDto {
  id: string;
  schoolId: string;
  userId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
