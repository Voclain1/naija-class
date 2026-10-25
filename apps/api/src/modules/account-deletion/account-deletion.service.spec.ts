import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AccountDeletionService, openAccountDeletionRequestCount } from "./account-deletion.service.js";

// Account deletion requests (docs/modules/account-deletion-requests.md), on a
// real database: one open request per person, the school's list with names,
// marking handled, the role check, and each school's requests kept to itself.

const service = new AccountDeletionService();
const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: null };

async function makeSchool(tag: string) {
  const school = await basePrisma.school.create({ data: { name: `Del ${tag} ${runId}`, slug: `del-${tag}-${runId}` }, select: { id: true } });
  return withTenant(school.id, async (db) => {
    const admin = await db.user.create({ data: { schoolId: school.id, email: `del-${tag}-a-${runId}@t.test`, firstName: "Ada", lastName: "Admin" }, select: { id: true } });
    const teacher = await db.user.create({ data: { schoolId: school.id, email: `del-${tag}-t-${runId}@t.test`, firstName: "Tunde", lastName: "Teacher" }, select: { id: true } });
    const role = await db.role.findFirst({ where: { key: "admin", isSystem: true }, select: { id: true } });
    if (!role) throw new Error("system `admin` role missing — run `pnpm db:seed`");
    await db.userRole.create({ data: { userId: admin.id, roleId: role.id } });
    const guardian = await db.guardian.create({ data: { schoolId: school.id, firstName: "Ngozi", lastName: "Parent", relationship: "MOTHER", phone: `+2348031${runId.length}0000${tag === "a" ? 1 : 2}` }, select: { id: true } });
    return {
      schoolId: school.id,
      admin: { schoolId: school.id, userId: admin.id } as unknown as AuthContext,
      teacher: { schoolId: school.id, userId: teacher.id } as unknown as AuthContext,
      guardianId: guardian.id,
    };
  });
}

describe("AccountDeletionService", () => {
  let a: Awaited<ReturnType<typeof makeSchool>>;
  let b: Awaited<ReturnType<typeof makeSchool>>;

  beforeAll(async () => {
    a = await makeSchool("a");
    b = await makeSchool("b");
  });

  afterAll(async () => {
    for (const s of [a, b]) {
      if (!s) continue;
      await withTenant(s.schoolId, async (db) => {
        await db.accountDeletionRequest.deleteMany({ where: { schoolId: s.schoolId } });
        await db.auditLog.deleteMany({ where: { schoolId: s.schoolId } });
      });
      await basePrisma.school.delete({ where: { id: s.schoolId } }).catch(() => undefined);
    }
  });

  it("records one open request per person: asking twice changes nothing", async () => {
    const parent = { schoolId: a.schoolId, principal: "GUARDIAN" as const, subjectId: a.guardianId };
    await expect(service.mine(parent)).resolves.toEqual({ requestedAt: null });
    const first = await service.request(parent, reqCtx);
    expect(first.requestedAt).not.toBeNull();
    const again = await service.request(parent, reqCtx);
    expect(again.requestedAt).toBe(first.requestedAt);
    const rows = await withTenant(a.schoolId, (db) => db.accountDeletionRequest.count({ where: { subjectId: a.guardianId } }));
    expect(rows).toBe(1);
    const audits = await withTenant(a.schoolId, (db) => db.auditLog.count({ where: { action: "account.deletion_requested" } }));
    expect(audits).toBe(1);
  });

  it("lists open requests with names for the school's admin, and refuses a teacher", async () => {
    await service.request({ schoolId: a.schoolId, principal: "STAFF", subjectId: a.teacher.userId, userId: a.teacher.userId }, reqCtx);
    const list = await service.list(a.admin);
    expect(list.map((r) => [r.principal, r.name])).toEqual(
      expect.arrayContaining([
        ["GUARDIAN", "Ngozi Parent"],
        ["STAFF", "Tunde Teacher"],
      ]),
    );
    await expect(service.list(a.teacher)).rejects.toThrow();
    await expect(withTenant(a.schoolId, (db) => openAccountDeletionRequestCount(db))).resolves.toBe(2);
  });

  it("marks a request handled once, and a person can then ask again", async () => {
    const [first] = await service.list(a.admin);
    await service.markHandled(a.admin, first!.id, reqCtx);
    await expect(service.markHandled(a.admin, first!.id, reqCtx)).rejects.toThrow(/already handled/i);
    expect((await service.list(a.admin)).map((r) => r.id)).not.toContain(first!.id);
    const asked = await service.request({ schoolId: a.schoolId, principal: first!.principal, subjectId: first!.subjectId }, reqCtx);
    expect(asked.requestedAt).not.toBeNull();
  });

  it("keeps each school's requests to itself", async () => {
    expect(await service.list(b.admin)).toEqual([]);
    const [mine] = await service.list(a.admin);
    await expect(service.markHandled(b.admin, mine!.id, reqCtx)).rejects.toThrow(/not found/i);
  });
});
