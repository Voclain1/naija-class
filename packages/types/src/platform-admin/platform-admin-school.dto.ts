// GET /platform-admin/schools — mirrors platform_admin_list_schools()'s
// return shape exactly (see CLAUDE.md's SECURITY DEFINER inventory). Keep
// this in sync with that function's column list — it is the single source
// of truth for what this surface is allowed to expose.
export interface PlatformAdminSchoolDto {
  schoolId: string;
  name: string;
  // The school's public URL key. On the roster because two schools can share
  // a name, and the slug is what tells them apart before an operator acts.
  slug: string;
  createdAt: string;
  isActive: boolean;
  studentCount: number;
  staffCount: number;
  // True iff an unaccepted, unexpired `owner`-role Invitation exists for
  // this school — i.e. it was provisioned via POST /platform-admin/schools
  // and the owner hasn't accepted yet. Always false for self-serve schools.
  // True when a staff account at the school holds the `owner` role. False
  // means nobody has accepted an owner invitation yet — the case the
  // dashboard offers "resend owner invite" for, whether or not the last
  // invitation has expired.
  hasOwner: boolean;
  ownerInvitePending: boolean;
  ownerInviteExpiresAt: string | null;
  // When this school was marked early-access, or null (the default, and the
  // overwhelming majority). Purely a marker today — NOTHING reads it to make
  // a decision. It exists so that when paid tiers ship, "who was here early
  // and should be grandfathered" is answerable from a deliberate flag rather
  // than reverse-engineered from createdAt. See School.earlyAccessGrantedAt
  // in schema.prisma and docs/deferred.md "Pricing / tier enforcement".
  earlyAccessGrantedAt: string | null;
  // The per-school AI kill switch (School.aiEnabled). Unlike
  // earlyAccessGrantedAt above, this one is NOT inert — it is read on the hot
  // path by AiGenerationService.reserve(). True here does not mean the school
  // is actually generating anything: the platform-wide AI_ENABLED env var is
  // a separate gate this field says nothing about. Toggled via
  // PATCH /platform-admin/schools/:schoolId/ai.
  aiEnabled: boolean;
  // The per-school monthly AI cap in tokens as set by an operator, or null
  // for "the platform default". Set via
  // PATCH /platform-admin/schools/:schoolId/ai-budget.
  aiMonthlyTokenBudget: number | null;
  // What the budget check actually enforces: the value above, or the
  // platform default when it is null. Returned so the dashboard never has to
  // carry its own copy of the default.
  aiEffectiveMonthlyTokenBudget: number;
  // The per-school staff mobile rollout gate (School.staffMobileEnabled,
  // DEFAULT false). Toggled via PATCH /platform-admin/schools/:schoolId/
  // staff-mobile. Present here so that endpoint is not a blind write — and
  // specifically so a DISABLE is checkable: an ENABLE has an accidental
  // substitute proof (a successful staff mobile login can only happen when the
  // flag is true, since it is re-read at both password acceptance and 2FA
  // challenge completion), but a disable has none — "nobody logged in" is not
  // an observation. Says nothing about WHICH staff: role grants and the
  // per-principal guards are separate gates.
  staffMobileEnabled: boolean;
}
