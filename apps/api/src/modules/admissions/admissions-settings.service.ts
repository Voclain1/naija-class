import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  ValidationError,
  type AdmissionOfficerDto,
  type AdmissionSettingsDto,
  type SetAdmissionOfficersInput,
  type UpdateAdmissionSettingsInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { applyPath, loadAdmissionSettings } from "./admissions.shared.js";

// Phase 9 / CP7.1 — Settings → Admissions (docs/modules/phase-9.md §16.8).
// Owner and admin: the switch (on by default), the classes open, the school's
// own form, who is told, the default offer letter, and the Admissions
// officers. An officer is an EXTRA role on a member of staff who keeps their
// own; granting and removing are audited.

const ROLE_NAMES: Record<string, string> = {
  teacher: "Teacher",
  bursar: "Bursar",
  health_officer: "Health officer",
  librarian: "Librarian",
  house_master: "House master",
};

const ADMISSION_SETTINGS_ROLES = ["owner", "admin"] as const;

interface RequestContext {
  ipAddress: string | null;
}

@Injectable()
export class AdmissionsSettingsService {
  async get(authCtx: AuthContext): Promise<AdmissionSettingsDto> {
    await assertUserActiveAndHasOneOf(authCtx, ADMISSION_SETTINGS_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const s = await loadAdmissionSettings(db, authCtx.schoolId);
      const levels = await db.classLevel.findMany({ where: { schoolId: authCtx.schoolId }, orderBy: { orderIndex: "asc" }, select: { id: true, name: true } });
      const school = await db.school.findUniqueOrThrow({ where: { id: authCtx.schoolId }, select: { slug: true } });
      return {
        enabled: s.enabled,
        intro: s.intro,
        smsAlerts: s.smsAlerts,
        notifyEmail: s.notifyEmail,
        offerLetter: s.offerLetter,
        form: s.form,
        classLevels: levels.map((l) => ({ ...l, open: !s.closedClassLevelIds.includes(l.id) })),
        applyPath: applyPath(school.slug),
      };
    });
  }

  async update(authCtx: AuthContext, input: UpdateAdmissionSettingsInput, req: RequestContext): Promise<AdmissionSettingsDto> {
    await assertUserActiveAndHasOneOf(authCtx, ADMISSION_SETTINGS_ROLES);
    const ids = new Set(input.form.questions.map((q) => q.id));
    if (ids.size !== input.form.questions.length) throw new ValidationError("Two questions share an id.");
    await withTenant(authCtx.schoolId, async (db) => {
      const levels = await db.classLevel.findMany({ where: { schoolId: authCtx.schoolId }, select: { id: true } });
      const known = new Set(levels.map((l) => l.id));
      const closed = [...new Set(input.closedClassLevelIds)].filter((id) => known.has(id));
      const data = {
        enabled: input.enabled,
        intro: input.intro || null,
        smsAlerts: input.smsAlerts,
        notifyEmail: input.notifyEmail || null,
        offerLetter: input.offerLetter || null,
        form: input.form,
        closedClassLevelIds: closed,
      };
      await db.admissionSettings.upsert({ where: { schoolId: authCtx.schoolId }, create: { schoolId: authCtx.schoolId, ...data }, update: data });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: "admission.settings",
          entityType: "admission_settings",
          entityId: authCtx.schoolId,
          ipAddress: req.ipAddress,
          metadata: { enabled: input.enabled, closedClasses: closed.length, questions: input.form.questions.length, smsAlerts: input.smsAlerts },
        },
      });
    });
    return this.get(authCtx);
  }

  /** Active staff who could be made Admissions officers: everyone but owners and admins, who already can. */
  async officers(authCtx: AuthContext): Promise<AdmissionOfficerDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ADMISSION_SETTINGS_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const users = await db.user.findMany({
        where: { schoolId: authCtx.schoolId, isActive: true, NOT: { roles: { some: { role: { key: { in: ["owner", "admin"] } } } } } },
        select: { id: true, firstName: true, lastName: true, roles: { select: { role: { select: { key: true } } } } },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      });
      return users
        .filter((u) => u.roles.length > 0)
        .map((u) => {
          const keys = u.roles.map((r) => r.role.key);
          return {
            id: u.id,
            name: `${u.firstName} ${u.lastName}`.trim(),
            roles: keys.filter((k) => k !== "admission_officer").map((k) => ROLE_NAMES[k] ?? k),
            isOfficer: keys.includes("admission_officer"),
          };
        });
    });
  }

  /** Grants the Admissions officer role to exactly these staff; removes it from the rest. */
  async setOfficers(authCtx: AuthContext, input: SetAdmissionOfficersInput, req: RequestContext): Promise<AdmissionOfficerDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ADMISSION_SETTINGS_ROLES);
    const wanted = new Set(input.userIds);
    await withTenant(authCtx.schoolId, async (db) => {
      const role = await db.role.findFirstOrThrow({ where: { schoolId: null, key: "admission_officer", isSystem: true }, select: { id: true } });
      const candidates = await this.officers(authCtx);
      const allowed = new Set(candidates.map((c) => c.id));
      for (const id of wanted) {
        if (!allowed.has(id)) throw new ValidationError("Choose active staff who are not owners or admins.");
      }
      const current = new Set(candidates.filter((c) => c.isOfficer).map((c) => c.id));
      const grant = [...wanted].filter((id) => !current.has(id));
      const remove = [...current].filter((id) => !wanted.has(id));
      if (grant.length) await db.userRole.createMany({ data: grant.map((userId) => ({ userId, roleId: role.id })), skipDuplicates: true });
      if (remove.length) await db.userRole.deleteMany({ where: { roleId: role.id, userId: { in: remove } } });
      for (const [action, ids] of [["admission.officer.grant", grant], ["admission.officer.remove", remove]] as const) {
        for (const userId of ids) {
          await db.auditLog.create({
            data: { schoolId: authCtx.schoolId, userId: authCtx.userId, action, entityType: "user", entityId: userId, ipAddress: req.ipAddress, metadata: {} },
          });
        }
      }
    });
    return this.officers(authCtx);
  }
}
