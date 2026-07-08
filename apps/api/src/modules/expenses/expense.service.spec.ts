import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { ExpenseCategoryService } from "./expense-category.service";
import { ExpenseService } from "./expense.service";

// Phase 3 / Slice 13 cp1 — expense integration spec. Real DB + RLS.
// Covers: create (happy, category-not-found, cross-tenant category rejected),
// findAll (categoryId filter, date range filter), findById, update (partial,
// categoryId re-validation), delete, audit rows, cross-tenant isolation.
//
// categoryId has no DB FK (plain FK — see schema.prisma header comment on
// Expense), so the "category must exist and belong to this school" guard is
// entirely service-layer; the cross-tenant-category test is the one that
// would silently pass with a dangling reference if that guard were missing.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const r = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23493${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: null as string | null };
function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

describe("ExpenseService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const categorySvc = new ExpenseCategoryService();
  const svc = new ExpenseService();
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  async function makeSchool(
    suffix: string,
  ): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await auth.signupOwner(
      {
        schoolName: `Expense ${suffix}`,
        schoolSlug: `expense-${suffix}-${runId}`,
        ownerFirstName: "Ada",
        ownerLastName: "Owner",
        ownerEmail: `expense-${suffix}-${runId}@example.test`,
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

  async function makeCategory(schoolId: string, ownerId: string, name: string): Promise<string> {
    const cat = await categorySvc.create(ctx(schoolId, ownerId), { name }, reqCtx);
    return cat.id;
  }

  describe("create", () => {
    it("creates an expense against an existing category", async () => {
      const { schoolId, ownerId } = await makeSchool("c1");
      const categoryId = await makeCategory(schoolId, ownerId, "Diesel");
      const result = await svc.create(
        ctx(schoolId, ownerId),
        { categoryId, amount: 15_000_00, description: "Generator fuel", incurredAt: "2026-06-15" },
        reqCtx,
      );
      expect(result.categoryId).toBe(categoryId);
      expect(result.amount).toBe(15_000_00);
      expect(result.description).toBe("Generator fuel");
      expect(result.receiptUrl).toBeNull();
      expect(result.recordedBy).toBe(ownerId);
    });

    it("rejects a categoryId that doesn't exist", async () => {
      const { schoolId, ownerId } = await makeSchool("c2");
      await expect(
        svc.create(
          ctx(schoolId, ownerId),
          { categoryId: "00000000-0000-0000-0000-000000000000", amount: 1000, incurredAt: "2026-06-01" },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("rejects a categoryId that belongs to a different school", async () => {
      const a = await makeSchool("c3a");
      const b = await makeSchool("c3b");
      const categoryIdA = await makeCategory(a.schoolId, a.ownerId, "Shared Name Cat");
      await expect(
        svc.create(
          ctx(b.schoolId, b.ownerId),
          { categoryId: categoryIdA, amount: 1000, incurredAt: "2026-06-01" },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("writes an audit log row for the create action", async () => {
      const { schoolId, ownerId } = await makeSchool("c4");
      const categoryId = await makeCategory(schoolId, ownerId, "Stationery");
      const created = await svc.create(
        ctx(schoolId, ownerId),
        { categoryId, amount: 5_000_00, incurredAt: "2026-06-10" },
        reqCtx,
      );
      const log = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({ where: { entityId: created.id, action: "expense.create" } }),
      );
      expect(log).not.toBeNull();
      expect(log?.userId).toBe(ownerId);
    });
  });

  describe("findAll", () => {
    it("filters by categoryId", async () => {
      const { schoolId, ownerId } = await makeSchool("fa1");
      const authCtx = ctx(schoolId, ownerId);
      const catA = await makeCategory(schoolId, ownerId, "Cat A");
      const catB = await makeCategory(schoolId, ownerId, "Cat B");
      await svc.create(authCtx, { categoryId: catA, amount: 1000, incurredAt: "2026-06-01" }, reqCtx);
      await svc.create(authCtx, { categoryId: catB, amount: 2000, incurredAt: "2026-06-01" }, reqCtx);

      const onlyA = await svc.findAll(authCtx, { categoryId: catA });
      expect(onlyA.every((e) => e.categoryId === catA)).toBe(true);
      expect(onlyA.length).toBe(1);
    });

    it("filters by incurredAt date range", async () => {
      const { schoolId, ownerId } = await makeSchool("fa2");
      const authCtx = ctx(schoolId, ownerId);
      const categoryId = await makeCategory(schoolId, ownerId, "Range Cat");
      await svc.create(authCtx, { categoryId, amount: 1000, incurredAt: "2026-05-01" }, reqCtx);
      await svc.create(authCtx, { categoryId, amount: 2000, incurredAt: "2026-06-15" }, reqCtx);
      await svc.create(authCtx, { categoryId, amount: 3000, incurredAt: "2026-07-20" }, reqCtx);

      const inRange = await svc.findAll(authCtx, { from: "2026-06-01", to: "2026-06-30" });
      expect(inRange.map((e) => e.amount)).toEqual([2000]);
    });

    it("is isolated per school (RLS)", async () => {
      const a = await makeSchool("fa3a");
      const b = await makeSchool("fa3b");
      const categoryId = await makeCategory(a.schoolId, a.ownerId, "A Cat");
      await svc.create(ctx(a.schoolId, a.ownerId), { categoryId, amount: 1000, incurredAt: "2026-06-01" }, reqCtx);

      const listB = await svc.findAll(ctx(b.schoolId, b.ownerId));
      expect(listB.length).toBe(0);
    });
  });

  describe("findById", () => {
    it("throws NotFoundError for a missing id", async () => {
      const { schoolId, ownerId } = await makeSchool("fb1");
      await expect(
        svc.findById(ctx(schoolId, ownerId), "00000000-0000-0000-0000-000000000000"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws NotFoundError when id belongs to another school", async () => {
      const a = await makeSchool("fb2a");
      const b = await makeSchool("fb2b");
      const categoryId = await makeCategory(a.schoolId, a.ownerId, "Isolated Cat");
      const created = await svc.create(
        ctx(a.schoolId, a.ownerId),
        { categoryId, amount: 1000, incurredAt: "2026-06-01" },
        reqCtx,
      );
      await expect(
        svc.findById(ctx(b.schoolId, b.ownerId), created.id),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("update", () => {
    it("updates amount, description, and incurredAt freely (no snapshot semantics)", async () => {
      const { schoolId, ownerId } = await makeSchool("u1");
      const authCtx = ctx(schoolId, ownerId);
      const categoryId = await makeCategory(schoolId, ownerId, "Cat");
      const created = await svc.create(authCtx, { categoryId, amount: 1000, incurredAt: "2026-06-01" }, reqCtx);
      const updated = await svc.update(
        authCtx,
        created.id,
        { amount: 2000, description: "Corrected amount", incurredAt: "2026-06-02" },
        reqCtx,
      );
      expect(updated.amount).toBe(2000);
      expect(updated.description).toBe("Corrected amount");
    });

    it("re-validates categoryId when it changes", async () => {
      const { schoolId, ownerId } = await makeSchool("u2");
      const authCtx = ctx(schoolId, ownerId);
      const categoryId = await makeCategory(schoolId, ownerId, "Cat");
      const created = await svc.create(authCtx, { categoryId, amount: 1000, incurredAt: "2026-06-01" }, reqCtx);
      await expect(
        svc.update(authCtx, created.id, { categoryId: "00000000-0000-0000-0000-000000000000" }, reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws NotFoundError for missing id", async () => {
      const { schoolId, ownerId } = await makeSchool("u3");
      await expect(
        svc.update(ctx(schoolId, ownerId), "00000000-0000-0000-0000-000000000000", { amount: 5000 }, reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("delete", () => {
    it("deletes an expense", async () => {
      const { schoolId, ownerId } = await makeSchool("d1");
      const authCtx = ctx(schoolId, ownerId);
      const categoryId = await makeCategory(schoolId, ownerId, "Cat");
      const created = await svc.create(authCtx, { categoryId, amount: 1000, incurredAt: "2026-06-01" }, reqCtx);
      await svc.delete(authCtx, created.id, reqCtx);
      await expect(svc.findById(authCtx, created.id)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws NotFoundError for a missing id", async () => {
      const { schoolId, ownerId } = await makeSchool("d2");
      await expect(
        svc.delete(ctx(schoolId, ownerId), "00000000-0000-0000-0000-000000000000", reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("writes an audit log row for the delete action", async () => {
      const { schoolId, ownerId } = await makeSchool("d3");
      const authCtx = ctx(schoolId, ownerId);
      const categoryId = await makeCategory(schoolId, ownerId, "Cat");
      const created = await svc.create(authCtx, { categoryId, amount: 1000, incurredAt: "2026-06-01" }, reqCtx);
      await svc.delete(authCtx, created.id, reqCtx);
      const log = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({ where: { entityId: created.id, action: "expense.delete" } }),
      );
      expect(log).not.toBeNull();
    });
  });
});
