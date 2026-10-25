import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { PARENT_CONSENT_VERSION, SCHOOL_CONSENT_VERSION } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AUDIT, DataProtectionService } from "./data-protection.service.js";

// Data protection consent (docs/modules/data-protection.md), on a real
// database: the owner's confirmation with its version and who, an admin
// refused, a parent's consent with its version, an old record not counting as
// current, and each school's records kept to itself.

const service = new DataProtectionService();
const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: null };

async function makeSchool(tag: string) {
  const school = await basePrisma.school.create({
    data: { name: `DP ${tag} ${runId}`, slug: `dp-${tag}-${runId}`, ndprConsent: true, ndprConsentAt: new Date("2026-06-01T09:00:00Z") },
    select: { id: true },
  });
  return withTenant(school.id, async (db) => {
    const owner = await db.user.create({ data: { schoolId: school.id, email: `dp-${tag}-o-${runId}@t.test`, firstName: "Olu", lastName: "Owner" }, select: { id: true } });
    const admin = await db.user.create({ data: { schoolId: school.id, email: `dp-${tag}-a-${runId}@t.test`, firstName: "Ada", lastName: "Admin" }, select: { id: true } });
    for (const [userId, key] of [[owner.id, "owner"], [admin.id, "admin"]] as const) {
      const role = await db.role.findFirst({ where: { key, isSystem: true }, select: { id: true } });
      if (!role) throw new Error(`system \`${key}\` role missing — run \`pnpm db:seed\``);
      await db.userRole.create({ data: { userId, roleId: role.id } });
    }
    const guardian = await db.guardian.create({
      data: { schoolId: school.id, firstName: "Ngozi", lastName: "Parent", relationship: "MOTHER", phone: `+23480310000${tag === "a" ? 1 : 2}${runId.length}` },
      select: { id: true },
    });
    return {
      schoolId: school.id,
      owner: { schoolId: school.id, userId: owner.id } as unknown as AuthContext,
      admin: { schoolId: school.id, userId: admin.id } as unknown as AuthContext,
      guardianId: guardian.id,
    };
  });
}

describe("DataProtectionService", () => {
  let a: Awaited<ReturnType<typeof makeSchool>>;
  let b: Awaited<ReturnType<typeof makeSchool>>;

  beforeAll(async () => {
    a = await makeSchool("a");
    b = await makeSchool("b");
  });

  afterAll(async () => {
    for (const s of [a, b]) {
      if (!s) continue;
      await withTenant(s.schoolId, (db) => db.auditLog.deleteMany({ where: { schoolId: s.schoolId } }));
      await basePrisma.school.delete({ where: { id: s.schoolId } }).catch(() => undefined);
    }
  });

  it("an agreement recorded before versions were kept is not current", async () => {
    const dto = await service.school(a.admin);
    expect(dto.confirmedAt).toBe("2026-06-01T09:00:00.000Z");
    expect(dto.version).toBeNull();
    expect(dto.current).toBe(false);
    expect(dto.currentVersion).toBe(SCHOOL_CONSENT_VERSION);
  });

  it("only the owner can confirm, and the confirmation records the version and who", async () => {
    await expect(service.confirmSchool(a.admin, reqCtx)).rejects.toThrow();
    const dto = await service.confirmSchool(a.owner, reqCtx);
    expect(dto).toMatchObject({ version: SCHOOL_CONSENT_VERSION, current: true, confirmedByName: "Olu Owner" });
    const audits = await withTenant(a.schoolId, (db) => db.auditLog.count({ where: { action: AUDIT.schoolConfirmed } }));
    expect(audits).toBe(1);
  });

  it("records a parent's consent with its version", async () => {
    await expect(service.guardian(a.schoolId, a.guardianId)).resolves.toMatchObject({ acceptedAt: null, current: false });
    const dto = await service.consentGuardian(a.schoolId, a.guardianId, reqCtx);
    expect(dto).toMatchObject({ version: PARENT_CONSENT_VERSION, current: true });
    expect(dto.acceptedAt).not.toBeNull();
  });

  it("an older wording no longer counts once the version moves", async () => {
    await withTenant(a.schoolId, (db) => db.guardian.update({ where: { id: a.guardianId }, data: { portalConsentVersion: "2026-01-01" } }));
    await expect(service.guardian(a.schoolId, a.guardianId)).resolves.toMatchObject({ current: false, version: "2026-01-01" });
  });

  it("keeps each school's records to itself", async () => {
    await expect(service.guardian(b.schoolId, a.guardianId)).rejects.toThrow(/not found/i);
    await expect(service.consentGuardian(b.schoolId, a.guardianId, reqCtx)).rejects.toThrow(/not found/i);
    await expect(service.school(b.admin)).resolves.toMatchObject({ current: false, version: null });
  });
});
