import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { NotFoundError, ValidationError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { FeeCategoryService } from "./fee-category.service";
import { FeeItemService } from "./fee-item.service";

// Phase 3 / Slice 4 cp1 — fee-item integration spec. Real DB + RLS.
// Covers: create (happy, category cross-school, scope validation, arm/level),
// findAll (category filter, active filter), findById, update (partial, scope
// merge invariant), delete, cross-tenant isolation.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const r = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23492${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: null as string | null };
function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

describe("FeeItemService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const catSvc = new FeeCategoryService();
  const svc = new FeeItemService();
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // ---- fixtures ------------------------------------------------------------

  async function makeSchool(
    suffix: string,
  ): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await auth.signupOwner(
      {
        schoolName: `Fee Item ${suffix}`,
        schoolSlug: `fee-item-${suffix}-${runId}`,
        ownerFirstName: "Emeka",
        ownerLastName: "Owner",
        ownerEmail: `fee-item-${suffix}-${runId}@example.test`,
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

  async function makeCategory(schoolId: string, ownerId: string, name = "Tuition") {
    return catSvc.create(ctx(schoolId, ownerId), { name }, reqCtx);
  }

  async function makeLevel(schoolId: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const level = await db.classLevel.findFirstOrThrow({
        where: { schoolId },
        orderBy: { orderIndex: "asc" },
      });
      return level.id;
    });
  }

  async function makeArm(schoolId: string, classLevelId: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const arm = await db.classArm.create({
        data: {
          schoolId,
          classLevelId,
          name: `Arm-${runId}`,
          code: `arm-${runId}`,
        },
        select: { id: true },
      });
      return arm.id;
    });
  }

  async function _makeTerm(schoolId: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      let yearId: string;
      const existingYear = await db.academicYear.findFirst({
        where: { schoolId },
        select: { id: true },
      });
      if (existingYear) {
        yearId = existingYear.id;
      } else {
        const y = await db.academicYear.create({
          data: {
            schoolId,
            label: "2025/2026",
            startDate: new Date("2025-09-01"),
            endDate: new Date("2026-07-31"),
          },
          select: { id: true },
        });
        yearId = y.id;
      }

      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: yearId,
          sequence: 1,
          name: "First Term",
          startDate: new Date("2025-09-01"),
          endDate: new Date("2025-12-15"),
        },
        select: { id: true },
      });
      return term.id;
    });
  }

  // ---- create ---------------------------------------------------------------

  describe("create", () => {
    it("creates a fee item with no scope (school-wide)", async () => {
      const { schoolId, ownerId } = await makeSchool("cr1");
      const cat = await makeCategory(schoolId, ownerId);
      const item = await svc.create(
        ctx(schoolId, ownerId),
        { categoryId: cat.id, name: "Basic Tuition", amount: 50_000_00 },
        reqCtx,
      );
      expect(item.name).toBe("Basic Tuition");
      expect(item.amount).toBe(50_000_00);
      expect(item.classLevelId).toBeNull();
      expect(item.classArmId).toBeNull();
      expect(item.termId).toBeNull();
      expect(item.academicYearId).toBeNull();
    });

    it("creates a fee item scoped to a class level", async () => {
      const { schoolId, ownerId } = await makeSchool("cr2");
      const cat = await makeCategory(schoolId, ownerId);
      const levelId = await makeLevel(schoolId);
      const item = await svc.create(
        ctx(schoolId, ownerId),
        { categoryId: cat.id, name: "JSS1 Tuition", amount: 45_000_00, classLevelId: levelId },
        reqCtx,
      );
      expect(item.classLevelId).toBe(levelId);
      expect(item.classArmId).toBeNull();
    });

    it("creates a fee item scoped to a class arm (level also required)", async () => {
      const { schoolId, ownerId } = await makeSchool("cr3");
      const cat = await makeCategory(schoolId, ownerId);
      const levelId = await makeLevel(schoolId);
      const armId = await makeArm(schoolId, levelId);
      const item = await svc.create(
        ctx(schoolId, ownerId),
        {
          categoryId: cat.id,
          name: "Gold Arm Tuition",
          amount: 55_000_00,
          classLevelId: levelId,
          classArmId: armId,
        },
        reqCtx,
      );
      expect(item.classLevelId).toBe(levelId);
      expect(item.classArmId).toBe(armId);
    });

    it("rejects category from a different school", async () => {
      const a = await makeSchool("cr4a");
      const b = await makeSchool("cr4b");
      const catFromA = await makeCategory(a.schoolId, a.ownerId, "Other Cat");
      await expect(
        svc.create(
          ctx(b.schoolId, b.ownerId),
          { categoryId: catFromA.id, name: "Bad Item", amount: 1_000 },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("rejects a classLevelId that does not belong to the school", async () => {
      const a = await makeSchool("cr5a");
      const b = await makeSchool("cr5b");
      const cat = await makeCategory(b.schoolId, b.ownerId);
      const levelFromA = await makeLevel(a.schoolId);
      await expect(
        svc.create(
          ctx(b.schoolId, b.ownerId),
          {
            categoryId: cat.id,
            name: "Bad Scope",
            amount: 1_000,
            classLevelId: levelFromA,
          },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects an arm that does not belong to the given level", async () => {
      const { schoolId, ownerId } = await makeSchool("cr6");
      const cat = await makeCategory(schoolId, ownerId);
      const levelId = await makeLevel(schoolId);
      // Create a different level to attach the arm to.
      const otherLevelId = await withTenant(schoolId, (db) =>
        db.classLevel
          .create({
            data: {
              schoolId,
              name: "SS1",
              code: `ss1-${runId}`,
              stage: "SSS",
              orderIndex: 99,
            },
            select: { id: true },
          })
          .then((r) => r.id),
      );
      const armId = await makeArm(schoolId, otherLevelId);
      await expect(
        svc.create(
          ctx(schoolId, ownerId),
          {
            categoryId: cat.id,
            name: "Mismatch Arm",
            amount: 1_000,
            classLevelId: levelId,
            classArmId: armId,
          },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("writes an audit log row", async () => {
      const { schoolId, ownerId } = await makeSchool("cr7");
      const cat = await makeCategory(schoolId, ownerId);
      const item = await svc.create(
        ctx(schoolId, ownerId),
        { categoryId: cat.id, name: "Audit Item", amount: 10_000_00 },
        reqCtx,
      );
      const log = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { entityId: item.id, action: "fee-item.create" },
        }),
      );
      expect(log).not.toBeNull();
    });
  });

  // ---- findAll ---------------------------------------------------------------

  describe("findAll", () => {
    it("filters by categoryId", async () => {
      const { schoolId, ownerId } = await makeSchool("fa1");
      const cat1 = await makeCategory(schoolId, ownerId, "Cat 1");
      const cat2 = await makeCategory(schoolId, ownerId, "Cat 2");
      const authCtx = ctx(schoolId, ownerId);
      await svc.create(authCtx, { categoryId: cat1.id, name: "Item 1", amount: 1_000 }, reqCtx);
      await svc.create(authCtx, { categoryId: cat2.id, name: "Item 2", amount: 2_000 }, reqCtx);

      const forCat1 = await svc.findAll(authCtx, { categoryId: cat1.id });
      expect(forCat1.map((i) => i.name)).toEqual(["Item 1"]);
    });

    it("excludes inactive by default, includes when flag set", async () => {
      const { schoolId, ownerId } = await makeSchool("fa2");
      const cat = await makeCategory(schoolId, ownerId);
      const authCtx = ctx(schoolId, ownerId);
      await svc.create(authCtx, { categoryId: cat.id, name: "Active Item", amount: 1_000 }, reqCtx);
      const inactive = await svc.create(
        authCtx,
        { categoryId: cat.id, name: "Inactive Item", amount: 2_000 },
        reqCtx,
      );
      await svc.update(authCtx, inactive.id, { active: false }, reqCtx);

      const defaultList = await svc.findAll(authCtx);
      expect(defaultList.map((i) => i.name)).toContain("Active Item");
      expect(defaultList.map((i) => i.name)).not.toContain("Inactive Item");

      const fullList = await svc.findAll(authCtx, { includeInactive: true });
      expect(fullList.map((i) => i.name)).toContain("Inactive Item");
    });

    it("is isolated per school", async () => {
      const a = await makeSchool("fa3a");
      const b = await makeSchool("fa3b");
      const catA = await makeCategory(a.schoolId, a.ownerId, "Cat A");
      await svc.create(
        ctx(a.schoolId, a.ownerId),
        { categoryId: catA.id, name: "School A Item", amount: 500 },
        reqCtx,
      );
      const listB = await svc.findAll(ctx(b.schoolId, b.ownerId));
      expect(listB.map((i) => i.name)).not.toContain("School A Item");
    });
  });

  // ---- findById ---------------------------------------------------------------

  describe("findById", () => {
    it("returns item when found", async () => {
      const { schoolId, ownerId } = await makeSchool("fi1");
      const cat = await makeCategory(schoolId, ownerId);
      const item = await svc.create(
        ctx(schoolId, ownerId),
        { categoryId: cat.id, name: "Found Item", amount: 3_000 },
        reqCtx,
      );
      const found = await svc.findById(ctx(schoolId, ownerId), item.id);
      expect(found.id).toBe(item.id);
      expect(found.name).toBe("Found Item");
    });

    it("throws NotFoundError for missing id", async () => {
      const { schoolId, ownerId } = await makeSchool("fi2");
      await expect(
        svc.findById(ctx(schoolId, ownerId), "00000000-0000-0000-0000-000000000000"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws NotFoundError for id belonging to another school", async () => {
      const a = await makeSchool("fi3a");
      const b = await makeSchool("fi3b");
      const cat = await makeCategory(a.schoolId, a.ownerId);
      const item = await svc.create(
        ctx(a.schoolId, a.ownerId),
        { categoryId: cat.id, name: "Cross Item", amount: 1_000 },
        reqCtx,
      );
      await expect(
        svc.findById(ctx(b.schoolId, b.ownerId), item.id),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ---- update ---------------------------------------------------------------

  describe("update", () => {
    it("updates name and amount", async () => {
      const { schoolId, ownerId } = await makeSchool("up1");
      const cat = await makeCategory(schoolId, ownerId);
      const item = await svc.create(
        ctx(schoolId, ownerId),
        { categoryId: cat.id, name: "Old Name", amount: 1_000 },
        reqCtx,
      );
      const updated = await svc.update(
        ctx(schoolId, ownerId),
        item.id,
        { name: "New Name", amount: 2_000 },
        reqCtx,
      );
      expect(updated.name).toBe("New Name");
      expect(updated.amount).toBe(2_000);
    });

    it("rejects clearing classLevelId when classArmId is set", async () => {
      const { schoolId, ownerId } = await makeSchool("up2");
      const cat = await makeCategory(schoolId, ownerId);
      const levelId = await makeLevel(schoolId);
      const armId = await makeArm(schoolId, levelId);
      const item = await svc.create(
        ctx(schoolId, ownerId),
        {
          categoryId: cat.id,
          name: "Scoped",
          amount: 1_000,
          classLevelId: levelId,
          classArmId: armId,
        },
        reqCtx,
      );
      await expect(
        svc.update(ctx(schoolId, ownerId), item.id, { classLevelId: null }, reqCtx),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("can clear classArmId while keeping classLevelId", async () => {
      const { schoolId, ownerId } = await makeSchool("up3");
      const cat = await makeCategory(schoolId, ownerId);
      const levelId = await makeLevel(schoolId);
      const armId = await makeArm(schoolId, levelId);
      const item = await svc.create(
        ctx(schoolId, ownerId),
        {
          categoryId: cat.id,
          name: "Arm Scoped",
          amount: 1_000,
          classLevelId: levelId,
          classArmId: armId,
        },
        reqCtx,
      );
      const updated = await svc.update(
        ctx(schoolId, ownerId),
        item.id,
        { classArmId: null },
        reqCtx,
      );
      expect(updated.classArmId).toBeNull();
      expect(updated.classLevelId).toBe(levelId);
    });

    it("throws NotFoundError for missing id", async () => {
      const { schoolId, ownerId } = await makeSchool("up4");
      await expect(
        svc.update(
          ctx(schoolId, ownerId),
          "00000000-0000-0000-0000-000000000000",
          { name: "Ghost" },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ---- delete ---------------------------------------------------------------

  describe("delete", () => {
    it("deletes a fee item", async () => {
      const { schoolId, ownerId } = await makeSchool("del1");
      const cat = await makeCategory(schoolId, ownerId);
      const item = await svc.create(
        ctx(schoolId, ownerId),
        { categoryId: cat.id, name: "To Delete", amount: 5_000 },
        reqCtx,
      );
      await svc.delete(ctx(schoolId, ownerId), item.id, reqCtx);
      await expect(
        svc.findById(ctx(schoolId, ownerId), item.id),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws NotFoundError for a missing id", async () => {
      const { schoolId, ownerId } = await makeSchool("del2");
      await expect(
        svc.delete(
          ctx(schoolId, ownerId),
          "00000000-0000-0000-0000-000000000000",
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("writes an audit log row for delete", async () => {
      const { schoolId, ownerId } = await makeSchool("del3");
      const cat = await makeCategory(schoolId, ownerId);
      const item = await svc.create(
        ctx(schoolId, ownerId),
        { categoryId: cat.id, name: "Audit Del", amount: 1_000 },
        reqCtx,
      );
      const itemId = item.id;
      await svc.delete(ctx(schoolId, ownerId), itemId, reqCtx);
      const log = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { entityId: itemId, action: "fee-item.delete" },
        }),
      );
      expect(log).not.toBeNull();
    });
  });
});
