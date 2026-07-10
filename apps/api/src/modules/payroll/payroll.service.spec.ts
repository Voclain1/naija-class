import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, NotFoundError } from "@school-kit/types";

import { FilesystemStorageDriver } from "../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../common/storage/storage.service";
import { AuthService } from "../auth/auth.service";
import { PayrollService } from "./payroll.service";

// Phase 3 / Payroll CP3 — payroll integration spec. Real DB + RLS + real
// filesystem storage driver (mocking Prisma or storage here would defeat the
// point — the whole feature is "does the round-trip actually work").
// Covers: create (happy, netSalary computation, duplicate period rejected,
// unknown staff rejected), update (DRAFT only, netSalary recomputed), approve
// (DRAFT -> APPROVED, audit row, cannot re-approve), payslip generation
// (APPROVED-only guard, URL persisted + signed), cross-tenant isolation.
//
// No CP4 (Paystack transfer) coverage here — paystackTransferCode/PAID/FAILED
// are out of scope until that checkpoint lands.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const r = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23494${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: null as string | null };
function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

describe("PayrollService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const storageRoot = mkdtempSync(join(tmpdir(), "schoolkit-payroll-storage-"));
  const svc = new PayrollService(new StorageService(new FilesystemStorageDriver(storageRoot)));
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    rmSync(storageRoot, { recursive: true, force: true });
    await basePrisma.$disconnect();
  });

  async function makeSchool(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await auth.signupOwner(
      {
        schoolName: `Payroll ${suffix}`,
        schoolSlug: `payroll-${suffix}-${runId}`,
        ownerFirstName: "Pat",
        ownerLastName: "Owner",
        ownerEmail: `payroll-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIds.add(signed.school.id);
    await basePrisma.school.update({
      where: { id: signed.school.id },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });
    return { schoolId: signed.school.id, ownerId: signed.user.id };
  }

  async function makeStaff(schoolId: string, suffix: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const u = await db.user.create({
        data: {
          schoolId,
          email: `staff-${suffix}-${runId}@example.test`,
          phone: randomPhone(),
          firstName: "Sam",
          lastName: "Staff",
        },
        select: { id: true },
      });
      return u.id;
    });
  }

  describe("create", () => {
    it("creates a DRAFT payroll item with netSalary computed server-side", async () => {
      const { schoolId, ownerId } = await makeSchool("c1");
      const staffId = await makeStaff(schoolId, "c1");

      const result = await svc.create(
        ctx(schoolId, ownerId),
        {
          userId: staffId,
          period: "2026-07",
          grossSalary: 500_000_00,
          deductions: [
            { name: "PAYE", amount: 40_000_00 },
            { name: "Pension", amount: 10_000_00 },
          ],
        },
        reqCtx,
      );

      expect(result.status).toBe("DRAFT");
      expect(result.grossSalary).toBe(500_000_00);
      expect(result.netSalary).toBe(450_000_00);
      expect(result.deductions).toHaveLength(2);
      expect(result.payslipUrl).toBeNull();
      expect(result.approvedBy).toBeNull();
      expect(result.createdBy).toBe(ownerId);
    });

    it("computes netSalary correctly with no deductions", async () => {
      const { schoolId, ownerId } = await makeSchool("c2");
      const staffId = await makeStaff(schoolId, "c2");

      const result = await svc.create(
        ctx(schoolId, ownerId),
        { userId: staffId, period: "2026-07", grossSalary: 300_000_00, deductions: [] },
        reqCtx,
      );
      expect(result.netSalary).toBe(300_000_00);
    });

    it("rejects a userId that doesn't exist", async () => {
      const { schoolId, ownerId } = await makeSchool("c3");
      await expect(
        svc.create(
          ctx(schoolId, ownerId),
          { userId: "00000000-0000-0000-0000-000000000000", period: "2026-07", grossSalary: 100_000_00, deductions: [] },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("rejects a userId belonging to a different school", async () => {
      const a = await makeSchool("c4a");
      const b = await makeSchool("c4b");
      const staffOfB = await makeStaff(b.schoolId, "c4b");

      await expect(
        svc.create(
          ctx(a.schoolId, a.ownerId),
          { userId: staffOfB, period: "2026-07", grossSalary: 100_000_00, deductions: [] },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("rejects a duplicate (staff, period) pair", async () => {
      const { schoolId, ownerId } = await makeSchool("c5");
      const staffId = await makeStaff(schoolId, "c5");
      await svc.create(
        ctx(schoolId, ownerId),
        { userId: staffId, period: "2026-07", grossSalary: 100_000_00, deductions: [] },
        reqCtx,
      );
      await expect(
        svc.create(
          ctx(schoolId, ownerId),
          { userId: staffId, period: "2026-07", grossSalary: 200_000_00, deductions: [] },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("writes a payroll.create audit row", async () => {
      const { schoolId, ownerId } = await makeSchool("c6");
      const staffId = await makeStaff(schoolId, "c6");
      const result = await svc.create(
        ctx(schoolId, ownerId),
        { userId: staffId, period: "2026-07", grossSalary: 100_000_00, deductions: [] },
        reqCtx,
      );
      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({ where: { action: "payroll.create", entityId: result.id } }),
      );
      expect(audit).toBeTruthy();
      expect(audit!.schoolId).toBe(schoolId);
    });
  });

  describe("update", () => {
    it("recomputes netSalary when deductions change on a DRAFT item", async () => {
      const { schoolId, ownerId } = await makeSchool("u1");
      const staffId = await makeStaff(schoolId, "u1");
      const created = await svc.create(
        ctx(schoolId, ownerId),
        { userId: staffId, period: "2026-07", grossSalary: 500_000_00, deductions: [{ name: "PAYE", amount: 40_000_00 }] },
        reqCtx,
      );
      expect(created.netSalary).toBe(460_000_00);

      const updated = await svc.update(
        ctx(schoolId, ownerId),
        created.id,
        { deductions: [{ name: "PAYE", amount: 40_000_00 }, { name: "Pension", amount: 10_000_00 }] },
        reqCtx,
      );
      expect(updated.netSalary).toBe(450_000_00);
      expect(updated.deductions).toHaveLength(2);
    });

    it("recomputes netSalary when grossSalary changes", async () => {
      const { schoolId, ownerId } = await makeSchool("u2");
      const staffId = await makeStaff(schoolId, "u2");
      const created = await svc.create(
        ctx(schoolId, ownerId),
        { userId: staffId, period: "2026-07", grossSalary: 300_000_00, deductions: [] },
        reqCtx,
      );
      const updated = await svc.update(ctx(schoolId, ownerId), created.id, { grossSalary: 350_000_00 }, reqCtx);
      expect(updated.netSalary).toBe(350_000_00);
    });

    it("rejects editing an APPROVED item", async () => {
      const { schoolId, ownerId } = await makeSchool("u3");
      const staffId = await makeStaff(schoolId, "u3");
      const created = await svc.create(
        ctx(schoolId, ownerId),
        { userId: staffId, period: "2026-07", grossSalary: 300_000_00, deductions: [] },
        reqCtx,
      );
      await svc.approve(ctx(schoolId, ownerId), created.id, reqCtx);

      await expect(
        svc.update(ctx(schoolId, ownerId), created.id, { grossSalary: 999_000_00 }, reqCtx),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("approve", () => {
    it("transitions DRAFT -> APPROVED and writes a payroll.approve audit row", async () => {
      const { schoolId, ownerId } = await makeSchool("a1");
      const staffId = await makeStaff(schoolId, "a1");
      const created = await svc.create(
        ctx(schoolId, ownerId),
        { userId: staffId, period: "2026-07", grossSalary: 300_000_00, deductions: [] },
        reqCtx,
      );

      const approved = await svc.approve(ctx(schoolId, ownerId), created.id, reqCtx);
      expect(approved.status).toBe("APPROVED");
      expect(approved.approvedBy).toBe(ownerId);
      expect(approved.approvedAt).toBeInstanceOf(Date);

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({ where: { action: "payroll.approve", entityId: created.id } }),
      );
      expect(audit).toBeTruthy();
    });

    it("rejects approving an already-APPROVED item", async () => {
      const { schoolId, ownerId } = await makeSchool("a2");
      const staffId = await makeStaff(schoolId, "a2");
      const created = await svc.create(
        ctx(schoolId, ownerId),
        { userId: staffId, period: "2026-07", grossSalary: 300_000_00, deductions: [] },
        reqCtx,
      );
      await svc.approve(ctx(schoolId, ownerId), created.id, reqCtx);

      await expect(
        svc.approve(ctx(schoolId, ownerId), created.id, reqCtx),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("generatePayslip", () => {
    it("rejects generating a payslip for a DRAFT item", async () => {
      const { schoolId, ownerId } = await makeSchool("p1");
      const staffId = await makeStaff(schoolId, "p1");
      const created = await svc.create(
        ctx(schoolId, ownerId),
        { userId: staffId, period: "2026-07", grossSalary: 300_000_00, deductions: [] },
        reqCtx,
      );
      await expect(
        svc.generatePayslip(ctx(schoolId, ownerId), created.id, reqCtx),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("generates and persists the payslip URL for an APPROVED item, returns a signed view URL", async () => {
      const { schoolId, ownerId } = await makeSchool("p2");
      const staffId = await makeStaff(schoolId, "p2");
      const created = await svc.create(
        ctx(schoolId, ownerId),
        { userId: staffId, period: "2026-07", grossSalary: 300_000_00, deductions: [{ name: "PAYE", amount: 20_000_00 }] },
        reqCtx,
      );
      await svc.approve(ctx(schoolId, ownerId), created.id, reqCtx);

      const result = await svc.generatePayslip(ctx(schoolId, ownerId), created.id, reqCtx);
      expect(result.url).toBeTruthy();
      expect(result.expiresAt).toBeInstanceOf(Date);

      const row = await svc.findById(ctx(schoolId, ownerId), created.id);
      expect(row.payslipUrl).toBeTruthy();

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({ where: { action: "payroll.payslip-generate", entityId: created.id } }),
      );
      expect(audit).toBeTruthy();
    });
  });

  describe("cross-tenant isolation", () => {
    it("School B cannot read School A's payroll item", async () => {
      const a = await makeSchool("x1a");
      const b = await makeSchool("x1b");
      const staffA = await makeStaff(a.schoolId, "x1a");
      const created = await svc.create(
        ctx(a.schoolId, a.ownerId),
        { userId: staffA, period: "2026-07", grossSalary: 300_000_00, deductions: [] },
        reqCtx,
      );

      await expect(svc.findById(ctx(b.schoolId, b.ownerId), created.id)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("School B's payroll list never includes School A's items", async () => {
      const a = await makeSchool("x2a");
      const b = await makeSchool("x2b");
      const staffA = await makeStaff(a.schoolId, "x2a");
      await svc.create(
        ctx(a.schoolId, a.ownerId),
        { userId: staffA, period: "2026-08", grossSalary: 300_000_00, deductions: [] },
        reqCtx,
      );

      const listB = await svc.findAll(ctx(b.schoolId, b.ownerId), { period: "2026-08" });
      expect(listB).toHaveLength(0);
    });
  });
});
