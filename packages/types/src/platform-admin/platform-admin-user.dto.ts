import { z } from "zod";

// GET /platform-admin/users?schoolId= — optional filter; omitted means
// "every school". schoolId, when present, is just a UUID-shaped string at
// this layer — the service re-validates it the same way withTenant does.
export const platformAdminListUsersQuerySchema = z.object({
  schoolId: z.string().uuid().optional(),
});

export type PlatformAdminListUsersQuery = z.infer<typeof platformAdminListUsersQuerySchema>;

// Mirrors platform_admin_list_users()'s return shape exactly (see
// CLAUDE.md's SECURITY DEFINER inventory) — keep this in sync with that
// function's column list.
export interface PlatformAdminUserDto {
  userId: string;
  schoolId: string;
  firstName: string;
  lastName: string;
  roleNames: string[];
  createdAt: string;
  lastLoginAt: string | null;
  isActive: boolean;
}
