// GET /users — owner/admin only. Lists active and inactive users in the
// current school, excluding the requester (so the admin doesn't see
// themselves in the "other admins" list). Sorted createdAt desc.
//
// Phase 0 keeps the shape narrow. Phase 2+ extends with classes the user
// teaches, etc.; today we only need enough to render the settings/users
// table.

export interface UserRoleDto {
  key: string;
  name: string;
}

export interface UserListItemDto {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  isActive: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  lastLoginAt: string | Date | null;
  createdAt: string | Date;
  roles: UserRoleDto[];
  // The user's HR profile (TeacherProfile), or null. Joined server-side
  // (2026-10-10) so the staff roster no longer pages through
  // GET /teacher-profiles to learn it, which stopped at 200 profiles.
  teacherProfileId: string | null;
}
