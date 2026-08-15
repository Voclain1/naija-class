import { z } from "zod";

// POST /schools/me/paystack-setup-request — the school submits its banking
// details so the platform operator can create a Paystack subaccount on
// SchoolKit's integration and hand back the ACCT_ code.
//
// See docs/modules/paystack-assisted-setup.md. The short version: Paystack
// subaccounts belong to the integration that created them, and the API holds
// one platform-wide PAYSTACK_SECRET_KEY — so a school cannot create a usable
// subaccount itself, however much the pre-2026-08-15 copy told it to.
//
// These are the four things Paystack's own subaccount form requires (business
// name, bank, account number, and a contact), so this schema is deliberately
// shaped by Paystack's requirements rather than by our storage.
//
// D1: none of these fields ever travel by email. The notification to
// PAYSTACK_SETUP_EMAIL carries school name + request id + a link; the
// platform-admin dashboard is the review surface.

// Mirrors onboarding/step1-basics.dto.ts so phone validation stays consistent
// across entry points.
const PHONE_RE = /^\+?[0-9]{10,15}$/;

// NUBAN — every Nigerian bank account number is exactly 10 digits. Strict
// here because a wrong length is certainly a typo, and Paystack's own
// account-name resolution (the real check) costs an operator round-trip to
// discover. Not a substitute for that resolution: a 10-digit number can be
// valid and still belong to someone else.
const NUBAN_RE = /^[0-9]{10}$/;

export const createPaystackSetupRequestSchema = z
  .object({
    // What parents see on the Paystack checkout page and what appears on
    // settlement statements. Prefilled from School.name in the form but
    // editable — a school's trading name and its registered banking name are
    // not always the same string.
    businessName: z.string().trim().min(2).max(120),
    bankName: z.string().trim().min(2).max(100),
    accountNumber: z
      .string()
      .trim()
      .regex(NUBAN_RE, "account number must be exactly 10 digits"),
    // The name on the account as the school believes it reads. Paystack
    // independently resolves this at creation time and fails on mismatch;
    // capturing it here gives the operator something to compare against, so a
    // mismatch is a conversation rather than a mystery.
    accountName: z.string().trim().min(2).max(120),
    contactName: z.string().trim().min(2).max(120),
    contactEmail: z.string().trim().toLowerCase().email(),
    contactPhone: z
      .string()
      .trim()
      .regex(PHONE_RE, "phone must be 10–15 digits, optionally prefixed with +"),
  })
  .strict();

export type CreatePaystackSetupRequestInput = z.infer<
  typeof createPaystackSetupRequestSchema
>;
