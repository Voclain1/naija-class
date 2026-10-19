import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import { ValidationError, type MessagingStaffDto, type SetMessagingRolesInput } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";

// Phase 9 / CP8.1 — Settings → Messaging (docs/modules/phase-9.md §17.8): the
// admin appoints the Principal(s), Head teacher(s) and Inbox officers. Each is
// an EXTRA role on a member of staff who keeps their own, admins included (a
// principal is often an admin). Appointing and removing are audited.

const MESSAGE_SETTINGS_ROLES = ["owner", "admin"] as const;

const ROLE_NAMES: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  teacher: "Teacher",
  bursar: "Bursar",
  health_officer: "Health officer",
  librarian: "Librarian",
  house_master: "House master",
  storekeeper: "Storekeeper",
  admission_officer: "Admissions officer",
};

const APPOINTED = ["principal", "head_teacher", "inbox_officer"] as const;

interface RequestContext {
  ipAddress: string | null;
}

@Injectable()
export class MessagesSettingsService {
  /** Active staff, with what each is appointed to. */
  async staff(authCtx: AuthContext): Promise<MessagingStaffDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, MESSAGE_SETTINGS_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const users = await db.user.findMany({
        where: { schoolId: authCtx.schoolId, isActive: true, roles: { some: {} } },
        select: { id: true, firstName: true, lastName: true, roles: { select: { role: { select: { key: true } } } } },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      });
      return users.map((u) => {
        const keys = u.roles.map((r) => r.role.key);
        return {
          id: u.id,
          name: `${u.firstName} ${u.lastName}`.trim(),
          roles: keys.filter((k) => !(APPOINTED as readonly string[]).includes(k)).map((k) => ROLE_NAMES[k] ?? k),
          principal: keys.includes("principal"),
          headTeacher: keys.includes("head_teacher"),
          inboxOfficer: keys.includes("inbox_officer"),
        };
      });
    });
  }

  /** Appoints exactly these staff to each role; removes it from the rest. */
  async setRoles(authCtx: AuthContext, input: SetMessagingRolesInput, req: RequestContext): Promise<MessagingStaffDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, MESSAGE_SETTINGS_ROLES);
    const current = await this.staff(authCtx);
    const allowed = new Set(current.map((s) => s.id));
    const wanted: Record<(typeof APPOINTED)[number], Set<string>> = {
      principal: new Set(input.principalIds),
      head_teacher: new Set(input.headTeacherIds),
      inbox_officer: new Set(input.inboxOfficerIds),
    };
    for (const ids of Object.values(wanted)) for (const id of ids) if (!allowed.has(id)) throw new ValidationError("Choose active members of staff.");
    const held: Record<(typeof APPOINTED)[number], Set<string>> = {
      principal: new Set(current.filter((s) => s.principal).map((s) => s.id)),
      head_teacher: new Set(current.filter((s) => s.headTeacher).map((s) => s.id)),
      inbox_officer: new Set(current.filter((s) => s.inboxOfficer).map((s) => s.id)),
    };
    await withTenant(authCtx.schoolId, async (db) => {
      for (const key of APPOINTED) {
        const role = await db.role.findFirstOrThrow({ where: { schoolId: null, key, isSystem: true }, select: { id: true } });
        const grant = [...wanted[key]].filter((id) => !held[key].has(id));
        const remove = [...held[key]].filter((id) => !wanted[key].has(id));
        if (grant.length) await db.userRole.createMany({ data: grant.map((userId) => ({ userId, roleId: role.id })), skipDuplicates: true });
        if (remove.length) await db.userRole.deleteMany({ where: { roleId: role.id, userId: { in: remove } } });
        for (const [action, ids] of [[`messages.role.grant`, grant], [`messages.role.remove`, remove]] as const) {
          for (const userId of ids) {
            await db.auditLog.create({
              data: { schoolId: authCtx.schoolId, userId: authCtx.userId, action, entityType: "user", entityId: userId, ipAddress: req.ipAddress, metadata: { role: key } },
            });
          }
        }
      }
    });
    return this.staff(authCtx);
  }
}
