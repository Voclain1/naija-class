import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { inviteAdminSchema, NotFoundError, STAFF_SALARY_SET_AUDIT_ACTION } from "@school-kit/types";

import { userHoldsPermission } from "../../common/auth/role-check";
import { FilesystemStorageDriver } from "../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../common/storage/storage.service";
import { AuthService } from "../auth/auth.service";
import { InvitationsService } from "../invitations/invitations.service";
import { UsersService } from "../users/users.service";
import { PayrollService } from "./payroll.service";

// Staff salaries (2026-10-19, the owner: "when adding or inviting staff, add a
// salary field and link it with payroll"). Real Postgres under RLS. What the
// feature rests on:
//   * a salary typed on the invite becomes the person's saved salary when
//     they accept, and is audited;
//   * resending the invite keeps it;
//   * only someone holding payroll.process may set one;
//   * payroll reads the saved salary, and one school never sees another's.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, "0");
  return `+23887${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("staff salaries", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const auth = new AuthService();
  const users = new UsersService();
  const invitations = new InvitationsService();
  const storageRoot = mkdtempSync(join(tmpdir(), "schoolkit-salary-storage-"));
  const payroll = new PayrollService(new StorageService(new FilesystemStorageDriver(storageRoot)), {} as never);
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    rmSync(storageRoot, { recursive: true, force: true });
    await basePrisma.$disconnect();
  });

  async function school(suffix: string) {
    const signed = await auth.signupOwner(
      {
        schoolName: `Salary ${suffix}`,
        schoolSlug: `sal-${suffix}-${runId}`,
        ownerFirstName: "Ola",
        ownerLastName: "Owner",
        ownerEmail: `sal-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIds.add(signed.school.id);
    await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
    return { schoolId: signed.school.id, ownerCtx: { sessionId: "s", userId: signed.user.id, schoolId: signed.school.id } };
  }

  const accept = (token: string) =>
    invitations.accept(token, { firstName: "Tola", lastName: "Teacher", password: "Strong-Pass-9", ndprConsent: true }, reqCtx);

  it("moves the salary typed on the invite onto the staff member when they accept", async () => {
    const { schoolId, ownerCtx } = await school("accept");
    const sent = await users.invite(
      ownerCtx,
      { email: `t-accept-${runId}@example.test`, roleKey: "teacher", monthlyGross: 15_000_000 },
      reqCtx,
    );
    const joined = await accept(sent.token);

    const salaries = await payroll.listSalaries(ownerCtx);
    expect(salaries).toEqual([expect.objectContaining({ userId: joined.user.id, monthlyGross: 15_000_000 })]);
    const audit = await withTenant(schoolId, (db) =>
      db.auditLog.findFirst({ where: { action: STAFF_SALARY_SET_AUDIT_ACTION, entityId: joined.user.id } }),
    );
    // The inviter set it, so the audit names them, not the new teacher.
    expect(audit?.userId).toBe(ownerCtx.userId);
    expect(audit?.metadata).toMatchObject({ source: "invitation", monthlyGross: 15_000_000 });
  });

  it("keeps the salary when the invite is resent", async () => {
    const { ownerCtx } = await school("resend");
    const sent = await users.invite(
      ownerCtx,
      { email: `t-resend-${runId}@example.test`, roleKey: "teacher", monthlyGross: 9_000_000 },
      reqCtx,
    );
    const again = await users.resendInvitation(ownerCtx, sent.invitation.id, reqCtx);
    const joined = await accept(again.token);
    expect(await payroll.listSalaries(ownerCtx)).toEqual([
      expect.objectContaining({ userId: joined.user.id, monthlyGross: 9_000_000 }),
    ]);
  });

  it("sets no salary when the invite had none", async () => {
    const { ownerCtx } = await school("none");
    const sent = await users.invite(ownerCtx, { email: `t-none-${runId}@example.test`, roleKey: "teacher" }, reqCtx);
    await accept(sent.token);
    expect(await payroll.listSalaries(ownerCtx)).toEqual([]);
  });

  it("knows who may set pay: the owner yes, a role without payroll.process no", async () => {
    // UsersService.invite refuses a salary unless this says yes. Owner and
    // admin both hold payroll.process today, so the refusal is exercised on a
    // custom role a school might make later.
    const { schoolId, ownerCtx } = await school("noperm");
    const sent = await users.invite(ownerCtx, { email: `a-noperm-${runId}@example.test`, roleKey: "admin" }, reqCtx);
    const person = await accept(sent.token);
    await withTenant(schoolId, async (db) => {
      const role = await db.role.create({
        data: { schoolId, key: `inviter-${runId}`, name: "Inviter", isSystem: false, permissions: ["user.invite"] },
        select: { id: true },
      });
      await db.userRole.deleteMany({ where: { userId: person.user.id } });
      await db.userRole.create({ data: { userId: person.user.id, roleId: role.id } });
    });

    expect(await userHoldsPermission(ownerCtx, "payroll.process")).toBe(true);
    expect(await userHoldsPermission({ sessionId: "s", userId: person.user.id, schoolId }, "payroll.process")).toBe(false);
  });

  it("rejects a salary that is not a positive whole number of kobo", () => {
    for (const bad of [0, -5, 1.5, 10_000_000_001]) {
      expect(inviteAdminSchema.safeParse({ email: "x@example.test", monthlyGross: bad }).success).toBe(false);
    }
    expect(inviteAdminSchema.safeParse({ email: "x@example.test", monthlyGross: 12_345_600 }).success).toBe(true);
  });

  it("sets and changes a salary from the staff page, auditing the old and new amounts", async () => {
    const { schoolId, ownerCtx } = await school("set");
    const sent = await users.invite(ownerCtx, { email: `t-set-${runId}@example.test`, roleKey: "teacher" }, reqCtx);
    const joined = await accept(sent.token);

    await payroll.setSalary(ownerCtx, joined.user.id, { monthlyGross: 10_000_000 }, reqCtx);
    const changed = await payroll.setSalary(ownerCtx, joined.user.id, { monthlyGross: 12_500_000 }, reqCtx);

    expect(changed.monthlyGross).toBe(12_500_000);
    const audits = await withTenant(schoolId, (db) =>
      db.auditLog.findMany({
        where: { action: STAFF_SALARY_SET_AUDIT_ACTION, entityId: joined.user.id },
        orderBy: { createdAt: "asc" },
      }),
    );
    expect(audits.map((a) => a.metadata)).toEqual([
      expect.objectContaining({ from: null, to: 10_000_000 }),
      expect.objectContaining({ from: 10_000_000, to: 12_500_000 }),
    ]);
  });

  it("never reads or sets another school's salaries", async () => {
    const a = await school("tenant-a");
    const b = await school("tenant-b");
    const sent = await users.invite(b.ownerCtx, { email: `t-b-${runId}@example.test`, roleKey: "teacher", monthlyGross: 7_000_000 }, reqCtx);
    const bTeacher = await accept(sent.token);

    expect(await payroll.listSalaries(a.ownerCtx)).toEqual([]);
    await expect(payroll.setSalary(a.ownerCtx, bTeacher.user.id, { monthlyGross: 1 }, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
    // Control: B's own read sees it, so the empty list above is the boundary.
    expect(await payroll.listSalaries(b.ownerCtx)).toHaveLength(1);
  });
});
