// Shape of the school returned by GET /schools/me and by every
// POST /schools/me/onboarding/:step response. Wider than SignupOwnerSchoolDto
// because the wizard needs to round-trip the basics + branding fields the
// user is editing — those don't appear in the signup response because they
// aren't set yet at that point.
//
// Dates are typed as `string | Date` for the same reason as the auth DTOs:
// Nest's default JSON serializer converts Date → ISO string at the wire,
// but service-level callers (specs, internal handlers) see the raw Date.

export interface SchoolMeDto {
  id: string;
  name: string;
  slug: string;
  motto: string | null;
  // Canonical storage path (e.g. "schools/<id>/logo.png"), or null if no
  // logo has been uploaded — NOT a directly browsable URL. Same convention
  // as Expense.receiptUrl. Fetch a real, freshly-signed image URL from
  // `GET /schools/me/logo-url` (SchoolLogoUrlDto below) to actually display
  // it; set upload-only via `POST /schools/me/logo`, never via PATCH.
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  primaryColor: string | null;
  status: string;
  onboardingStep: number;
  ndprConsent: boolean;
  ndprConsentAt: string | Date | null;
  // Opt-in to subject-period attendance (Phase 2 / Slice 8). The admin settings
  // page reads + toggles this; the teacher portal learns it via /teacher-scope/me.
  subjectAttendanceEnabled: boolean;
  // Paystack subaccount routing (compressed plan-first, 2026-07-31). The raw
  // code is safe to echo back — it's an opaque Paystack identifier, not a
  // secret (same trust level as a bank account's last-4, not its full BVN).
  // paystackPaymentsEnabled can only be true when this is non-null (enforced
  // in SchoolsService.patchMe, not by the DB).
  paystackSubaccountCode: string | null;
  paystackSplitCode: string | null;
  paystackPaymentsEnabled: boolean;
  // Populated ONLY in the PATCH /schools/me response, and only when that
  // call just verified a new/changed subaccount code against Paystack —
  // the business name Paystack has on file for it, so the admin can
  // confirm "is this really my school's account" (a syntactically valid
  // but WRONG code — e.g. someone else's — passes the code-exists check
  // alone; the business name is what catches that). Always null on GET
  // /schools/me and on any PATCH that didn't touch the code — this is a
  // point-in-time confirmation, not a cached/persisted fact.
  paystackSubaccountBusinessName: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// Wrapper used by POST /schools/me/onboarding/:step responses. Wrapping in
// `{ school }` (rather than returning the school at the top level) leaves
// room to add per-step affordances later (e.g. step 3 returning
// `{ school, invitationIds }`) without a breaking shape change.
export interface OnboardingStepResponse {
  school: SchoolMeDto;
}

// GET /schools/me/logo-url response — a freshly-signed, directly displayable
// image URL (same "return a URL in JSON, let the caller set it as an <img>/
// <a> src directly" shape as ExpenseReceiptUrlDto). TTL is long (an hour)
// relative to receipts' 15 minutes: a logo is persistently displayed in the
// topbar for the life of a session, not fetched once for a single click-
// through, so it needs to survive much longer between re-fetches.
export interface SchoolLogoUrlDto {
  url: string;
}
