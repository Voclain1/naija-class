import { z } from "zod";

import type { PaystackSetupStatus } from "../paystack-setup/paystack-setup-request.dto.js";

// The platform operator's Paystack setup queue. See
// docs/modules/paystack-assisted-setup.md §2 D4 for why this is split into a
// browse tier and a reveal tier.

// ---------------------------------------------------------------------------
// Browse tier — GET /platform-admin/paystack-setup-requests
// ---------------------------------------------------------------------------

// Mirrors platform_admin_list_paystack_setup_requests()'s return shape
// exactly (see CLAUDE.md's SECURITY DEFINER inventory). Keep in sync with
// that function's column list — it is the single source of truth for what
// this surface may expose.
//
// NO BANKING FIELDS, deliberately. This list renders on page load for every
// pending request whether or not the operator is acting on one; account
// numbers here would spread through server logs, browser memory, and anything
// visible on screen, on every visit. businessName/contactName are what make a
// row recognisable — they are not contact detail.
export interface PlatformAdminPaystackSetupRequestDto {
  requestId: string;
  schoolId: string;
  schoolName: string;
  businessName: string;
  status: PaystackSetupStatus;
  submittedAt: string;
  contactName: string;
}

// ---------------------------------------------------------------------------
// Reveal tier — GET /platform-admin/paystack-setup-requests/:id/reveal
// ---------------------------------------------------------------------------

// The one surface that returns a school's account number. Every call writes a
// `paystack-setup.reveal` audit row recording who revealed what and when,
// never the value — exactly BvnService.revealBvn's contract.
//
// This is NOT served by a SECURITY DEFINER function: by the time it is
// called, the browse tier has resolved a schoolId, so a tenant exists and the
// read runs under an ordinary GUC with RLS governing it.
export interface PlatformAdminPaystackSetupRevealDto {
  requestId: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  contactEmail: string;
  contactPhone: string;
}

// ---------------------------------------------------------------------------
// Resolve — PATCH /platform-admin/paystack-setup-requests/:id
// ---------------------------------------------------------------------------

// FULFILLED requires the subaccount code that was actually issued: recording
// which code went to which school is the whole point of the request row
// outliving the email. REJECTED requires a reason, because a school that gets
// turned down with no explanation has nothing to act on.
//
// The cross-field rule (code required iff FULFILLED, notes required iff
// REJECTED) is expressed here as a discriminated union rather than at the
// service layer — unlike patchSchoolMe's "enabling requires a code", this one
// depends on nothing outside the payload, so the schema can enforce it.
export const platformAdminResolvePaystackSetupSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("FULFILLED"),
        subaccountCode: z
          .string()
          .trim()
          .regex(/^ACCT_[A-Za-z0-9]+$/, "subaccount code must look like ACCT_xxxxxxxxxx"),
        notes: z.string().trim().max(1000).optional(),
      })
      .strict(),
    z
      .object({
        status: z.literal("REJECTED"),
        notes: z.string().trim().min(1, "a reason is required when rejecting").max(1000),
      })
      .strict(),
  ],
);

export type PlatformAdminResolvePaystackSetupInput = z.infer<
  typeof platformAdminResolvePaystackSetupSchema
>;

export interface PlatformAdminResolvePaystackSetupResponse {
  requestId: string;
  status: PaystackSetupStatus;
}
