// GET /platform-admin/schools — mirrors platform_admin_list_schools()'s
// return shape exactly (see CLAUDE.md's SECURITY DEFINER inventory). Keep
// this in sync with that function's column list — it is the single source
// of truth for what this surface is allowed to expose.
export interface PlatformAdminSchoolDto {
  schoolId: string;
  name: string;
  createdAt: string;
  isActive: boolean;
  studentCount: number;
  staffCount: number;
  // True iff an unaccepted, unexpired `owner`-role Invitation exists for
  // this school — i.e. it was provisioned via POST /platform-admin/schools
  // and the owner hasn't accepted yet. Always false for self-serve schools.
  ownerInvitePending: boolean;
  ownerInviteExpiresAt: string | null;
}
