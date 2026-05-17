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
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  primaryColor: string | null;
  status: string;
  onboardingStep: number;
  ndprConsent: boolean;
  ndprConsentAt: string | Date | null;
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
