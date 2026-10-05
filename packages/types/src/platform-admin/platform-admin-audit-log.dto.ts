import { z } from "zod";

// GET /platform-admin/audit-log — platform-admin tools, slice 3
// (docs/modules/platform-admin.md). The owner's decision (2026-10-05): the
// audit trail is readable by PLATFORM ADMINS ONLY, to start, and only the
// platform's own rows — the ones written with school_id = NULL by this surface
// (provisioning, AI switch and budget, invitations, suspension, deletion,
// sign-ins). A school's own audit rows stay unreadable here; that is a
// separate decision (who at a school may read them, and how redacted).

// Actions that only record that a page was looked at. Hidden by default, so
// the list shows what CHANGED; `includeViews=true` shows them too.
export const PLATFORM_AUDIT_VIEW_ACTIONS = [
  "platform_admin.schools.list",
  "platform_admin.users.list",
  "platform_admin.paystack-setup.list",
  "platform_admin.schools.deletion-check",
  "platform_admin.audit-log.read",
] as const;

export const PLATFORM_AUDIT_PAGE_SIZE = 50;

export const platformAdminAuditLogQuerySchema = z.object({
  // Only entries about this school.
  schoolId: z.string().uuid().optional(),
  // "true" to include page views. A string, as query parameters are.
  includeViews: z.enum(["true", "false"]).optional(),
  // Opaque cursor from the previous page's `nextBefore`.
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type PlatformAdminAuditLogQuery = z.infer<typeof platformAdminAuditLogQuerySchema>;

export interface PlatformAdminAuditEntryDto {
  id: string;
  at: string;
  action: string;
  // Who did it. The name comes from the staff roster; null if the account is
  // gone (e.g. its school was deleted).
  actorUserId: string | null;
  actorName: string | null;
  // The school the entry is about, when it is about one. The name is read
  // live; a deleted school's name comes from the delete entry's metadata.
  schoolId: string | null;
  schoolName: string | null;
  // As written: no IP address, emails already redacted at write time.
  metadata: Record<string, unknown> | null;
}

export interface PlatformAdminAuditLogResponse {
  entries: PlatformAdminAuditEntryDto[];
  // Pass as `before` for the next page; null when there is no more.
  nextBefore: string | null;
}
