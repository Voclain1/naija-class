import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, NotFoundError, ValidationError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { FeeCategoryService } from "./fee-category.service";

// Phase 3 / Slice 4 cp1 — fee-category integration spec. Real DB + RLS.
// Covers: create (happy, name-conflict), findAll (active filter), findById,
// update (partial, name-change, conflict), delete (happy, has-items, not-found),
// cross-tenant isolation.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const r = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23491${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: null as string | null };
function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

describe("FeeCategoryService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const svc = new FeeCategoryService();
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
        schoolName: `Fee Cat ${suffix}`,
        schoolSlug: `fee-cat-${suffix}-${runId}`,
        ownerFirstName: "Ada",
        ownerLastName: "Owner",
        ownerEmail: `fee-cat-${suffix}-${runId}@example.test`,
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

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe("create", () => {
    it("creates a category and returns dto with itemCount=0", async () => {
      const { schoolId, ownerId } = await makeSchool("c1");
      const result = await svc.create(
        ctx(schoolId, ownerId),
        { name: "Tuition", description: "Term tuition fees" },
        reqCtx,
      );
      expect(result.name).toBe("Tuition");
      expect(result.description).toBe("Term tuition fees");
      expect(result.active).toBe(true);
      expect(result.itemCount).toBe(0);
      expect(result.schoolId).toBe(schoolId);
      expect(result.createdBy).toBe(ownerId);
    });

    it("rejects a duplicate name within the same school", async () => {
      const { schoolId, ownerId } = await makeSchool("c2");
      await svc.create(ctx(schoolId, ownerId), { name: "Tuition" }, reqCtx);
      await expect(
        svc.create(ctx(schoolId, ownerId), { name: "Tuition" }, reqCtx),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("allows the same name in two different schools", async () => {
      const a = await makeSchool("c3a");
      const b = await makeSchool("c3b");
      await svc.create(ctx(a.schoolId, a.ownerId), { name: "Transport" }, reqCtx);
      const result = await svc.create(
        ctx(b.schoolId, b.ownerId),
        { name: "Transport" },
        reqCtx,
      );
      expect(result.name).toBe("Transport");
    });

    it("writes an audit log row for the create action", async () => {
      const { schoolId, ownerId } = await makeSchool("c4");
      const created = await svc.create(
        ctx(schoolId, ownerId),
        { name: "Exam Levy" },
        reqCtx,
      );
      const log = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { entityId: created.id, action: "fee-category.create" },
        }),
      );
      expect(log).not.toBeNull();
      expect(log?.userId).toBe(ownerId);
    });
  });

  // -------------------------------------------------------------------------
  // findAll
  // -------------------------------------------------------------------------

  describe("findAll", () => {
    it("returns only active categories by default", async () => {
      const { schoolId, ownerId } = await makeSchool("fa1");
      const authCtx = ctx(schoolId, ownerId);
      await svc.create(authCtx, { name: "Active One" }, reqCtx);
      const inactive = await svc.create(authCtx, { name: "Inactive One" }, reqCtx);
      await svc.update(authCtx, inactive.id, { active: false }, reqCtx);

      const list = await svc.findAll(authCtx);
      expect(list.map((c) => c.name)).toContain("Active One");
      expect(list.map((c) => c.name)).not.toContain("Inactive One");
    });

    it("includes inactive categories when includeInactive=true", async () => {
      const { schoolId, ownerId } = await makeSchool("fa2");
      const authCtx = ctx(schoolId, ownerId);
      await svc.create(authCtx, { name: "Cat A" }, reqCtx);
      const cat = await svc.create(authCtx, { name: "Cat B" }, reqCtx);
      await svc.update(authCtx, cat.id, { active: false }, reqCtx);

      const list = await svc.findAll(authCtx, { includeInactive: true });
      expect(list.map((c) => c.name).sort()).toEqual(["Cat A", "Cat B"]);
    });

    it("is isolated per school (RLS)", async () => {
      const a = await makeSchool("fa3a");
      const b = await makeSchool("fa3b");
      await svc.create(ctx(a.schoolId, a.ownerId), { name: "School A Cat" }, reqCtx);

      const listB = await svc.findAll(ctx(b.schoolId, b.ownerId));
      expect(listB.map((c) => c.name)).not.toContain("School A Cat");
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe("findById", () => {
    it("returns the category when it exists in school", async () => {
      const { schoolId, ownerId } = await makeSchool("fb1");
      const created = await svc.create(ctx(schoolId, ownerId), { name: "Books" }, reqCtx);
      const found = await svc.findById(ctx(schoolId, ownerId), created.id);
      expect(found.id).toBe(created.id);
      expect(found.name).toBe("Books");
    });

    it("throws NotFoundError for a missing id", async () => {
      const { schoolId, ownerId } = await makeSchool("fb2");
      await expect(
        svc.findById(ctx(schoolId, ownerId), "00000000-0000-0000-0000-000000000000"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws NotFoundError when id belongs to another school (RLS isolation)", async () => {
      const a = await makeSchool("fb3a");
      const b = await makeSchool("fb3b");
      const created = await svc.create(
        ctx(a.schoolId, a.ownerId),
        { name: "Isolated Cat" },
        reqCtx,
      );
      await expect(
        svc.findById(ctx(b.schoolId, b.ownerId), created.id),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe("update", () => {
    it("updates name and description", async () => {
      const { schoolId, ownerId } = await makeSchool("u1");
      const created = await svc.create(
        ctx(schoolId, ownerId),
        { name: "Old Name", description: "Old desc" },
        reqCtx,
      );
      const updated = await svc.update(
        ctx(schoolId, ownerId),
        created.id,
        { name: "New Name", description: "New desc" },
        reqCtx,
      );
      expect(updated.name).toBe("New Name");
      expect(updated.description).toBe("New desc");
    });

    it("deactivates a category", async () => {
      const { schoolId, ownerId } = await makeSchool("u2");
      const created = await svc.create(
        ctx(schoolId, ownerId),
        { name: "To Deactivate" },
        reqCtx,
      );
      const updated = await svc.update(
        ctx(schoolId, ownerId),
        created.id,
        { active: false },
        reqCtx,
      );
      expect(updated.active).toBe(false);
    });

    it("rejects a name-change that conflicts with an existing category", async () => {
      const { schoolId, ownerId } = await makeSchool("u3");
      const authCtx = ctx(schoolId, ownerId);
      await svc.create(authCtx, { name: "Existing" }, reqCtx);
      const target = await svc.create(authCtx, { name: "Target" }, reqCtx);
      await expect(
        svc.update(authCtx, target.id, { name: "Existing" }, reqCtx),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("allows updating to the same name (no-op conflict check)", async () => {
      const { schoolId, ownerId } = await makeSchool("u4");
      const created = await svc.create(
        ctx(schoolId, ownerId),
        { name: "Same Name" },
        reqCtx,
      );
      const updated = await svc.update(
        ctx(schoolId, ownerId),
        created.id,
        { name: "Same Name" },
        reqCtx,
      );
      expect(updated.name).toBe("Same Name");
    });

    it("throws NotFoundError for missing id", async () => {
      const { schoolId, ownerId } = await makeSchool("u5");
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

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe("delete", () => {
    it("deletes a category with no items", async () => {
      const { schoolId, ownerId } = await makeSchool("d1");
      const created = await svc.create(
        ctx(schoolId, ownerId),
        { name: "Empty Cat" },
        reqCtx,
      );
      await svc.delete(ctx(schoolId, ownerId), created.id, reqCtx);
      await expect(
        svc.findById(ctx(schoolId, ownerId), created.id),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("rejects deletion when category has fee items", async () => {
      const { schoolId, ownerId } = await makeSchool("d2");
      const authCtx = ctx(schoolId, ownerId);
      const cat = await svc.create(authCtx, { name: "Cat With Items" }, reqCtx);
      // Insert a fee item directly to avoid importing FeeItemService here.
      await withTenant(schoolId, (db) =>
        db.feeItem.create({
          data: {
            schoolId,
            categoryId: cat.id,
            name: "Term 1 Fee",
            amount: 50_000_00,
            createdBy: ownerId,
          },
        }),
      );
      await expect(
        svc.delete(authCtx, cat.id, reqCtx),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("throws NotFoundError for a missing id", async () => {
      const { schoolId, ownerId } = await makeSchool("d3");
      await expect(
        svc.delete(
          ctx(schoolId, ownerId),
          "00000000-0000-0000-0000-000000000000",
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("writes an audit log row for the delete action", async () => {
      const { schoolId, ownerId } = await makeSchool("d4");
      const authCtx = ctx(schoolId, ownerId);
      const cat = await svc.create(authCtx, { name: "Audit Delete Cat" }, reqCtx);
      const catId = cat.id;
      await svc.delete(authCtx, catId, reqCtx);
      const log = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { entityId: catId, action: "fee-category.delete" },
        }),
      );
      expect(log).not.toBeNull();
    });
  });
});
