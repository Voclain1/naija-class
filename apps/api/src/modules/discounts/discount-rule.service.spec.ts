import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { NotFoundError, ValidationError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service.js";
import { DiscountRuleService } from "./discount-rule.service.js";

// Phase 3 / Slice 5 CP1 — discount-rule integration spec. Real DB + RLS.
// Covers: create (happy paths + rejections + audit log), findAll (filters +
// cross-tenant), findById, update, deactivate + audit log.

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

describe("DiscountRuleService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const svc = new DiscountRuleService();
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
        schoolName: `Discount ${suffix} ${runId}`,
        schoolSlug: `discount-${suffix}-${runId}`,
        ownerFirstName: "Bisi",
        ownerLastName: "Owner",
        ownerEmail: `discount-${suffix}-${runId}@example.test`,
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

  async function makeStudent(schoolId: string, suffix: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const s = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `ADM-${suffix}-${runId}`,
          firstName: "Test",
          lastName: "Student",
          dateOfBirth: new Date("2010-01-01"),
          gender: "MALE",
        },
        select: { id: true },
      });
      return s.id;
    });
  }

  async function makeFeeCategory(
    schoolId: string,
    ownerId: string,
    name: string,
  ): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const c = await db.feeCategory.create({
        data: { schoolId, name, createdBy: ownerId },
        select: { id: true },
      });
      return c.id;
    });
  }

  async function makeFeeItem(
    schoolId: string,
    categoryId: string,
    ownerId: string,
  ): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const i = await db.feeItem.create({
        data: {
          schoolId,
          categoryId,
          name: "Tuition Fee",
          amount: 100_000_00,
          createdBy: ownerId,
        },
        select: { id: true },
      });
      return i.id;
    });
  }

  async function makeAcademicYear(schoolId: string, label: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const y = await db.academicYear.create({
        data: {
          schoolId,
          label,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
        select: { id: true },
      });
      return y.id;
    });
  }

  async function makeTerm(schoolId: string, academicYearId: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const t = await db.term.create({
        data: {
          schoolId,
          academicYearId,
          sequence: 1,
          name: "First Term",
          startDate: new Date("2025-09-01"),
          endDate: new Date("2025-12-15"),
        },
        select: { id: true },
      });
      return t.id;
    });
  }

  // ── create ────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates PERCENTAGE discount scoped to a fee item for a TERM", async () => {
      const { schoolId, ownerId } = await makeSchool("cr-pct");
      const studentId = await makeStudent(schoolId, "cr-pct");
      const catId = await makeFeeCategory(schoolId, ownerId, "Tuition");
      const feeItemId = await makeFeeItem(schoolId, catId, ownerId);
      const yearId = await makeAcademicYear(schoolId, "2025/2026-cr-pct");
      const termId = await makeTerm(schoolId, yearId);

      const rule = await svc.create(
        ctx(schoolId, ownerId),
        {
          studentId,
          name: "Scholarship",
          feeItemId,
          duration: "TERM",
          termId,
          discountType: "PERCENTAGE",
          value: 1000, // 10%
        },
        reqCtx,
      );

      expect(rule.discountType).toBe("PERCENTAGE");
      expect(rule.value).toBe(1000);
      expect(rule.duration).toBe("TERM");
      expect(rule.termId).toBe(termId);
      expect(rule.feeItemId).toBe(feeItemId);
      expect(rule.feeCategoryId).toBeNull();
      expect(rule.active).toBe(true);
      expect(rule.schoolId).toBe(schoolId);
      expect(rule.studentId).toBe(studentId);
    });

    it("creates FIXED_AMOUNT discount scoped to a fee category for a SESSION", async () => {
      const { schoolId, ownerId } = await makeSchool("cr-fixed");
      const studentId = await makeStudent(schoolId, "cr-fixed");
      const catId = await makeFeeCategory(schoolId, ownerId, "Hostel");
      const yearId = await makeAcademicYear(schoolId, "2025/2026-cr-fixed");

      const rule = await svc.create(
        ctx(schoolId, ownerId),
        {
          studentId,
          name: "Staff child reduction",
          feeCategoryId: catId,
          duration: "SESSION",
          academicYearId: yearId,
          discountType: "FIXED_AMOUNT",
          value: 50_000_00, // ₦50,000 in kobo
        },
        reqCtx,
      );

      expect(rule.discountType).toBe("FIXED_AMOUNT");
      expect(rule.value).toBe(50_000_00);
      expect(rule.duration).toBe("SESSION");
      expect(rule.academicYearId).toBe(yearId);
      expect(rule.feeCategoryId).toBe(catId);
      expect(rule.feeItemId).toBeNull();
    });

    it("creates FULL_WAIVER discount with LIFETIME duration — value is null in DB", async () => {
      const { schoolId, ownerId } = await makeSchool("cr-waiver");
      const studentId = await makeStudent(schoolId, "cr-waiver");
      const catId = await makeFeeCategory(schoolId, ownerId, "Scholarship");
      const feeItemId = await makeFeeItem(schoolId, catId, ownerId);

      const rule = await svc.create(
        ctx(schoolId, ownerId),
        {
          studentId,
          name: "Full scholarship",
          feeItemId,
          duration: "LIFETIME",
          discountType: "FULL_WAIVER",
        },
        reqCtx,
      );

      expect(rule.discountType).toBe("FULL_WAIVER");
      expect(rule.value).toBeNull();
      expect(rule.duration).toBe("LIFETIME");
      expect(rule.termId).toBeNull();
      expect(rule.academicYearId).toBeNull();
    });

    it("writes an audit log entry on create", async () => {
      const { schoolId, ownerId } = await makeSchool("cr-audit");
      const studentId = await makeStudent(schoolId, "cr-audit");
      const catId = await makeFeeCategory(schoolId, ownerId, "PTA");
      const feeItemId = await makeFeeItem(schoolId, catId, ownerId);

      const rule = await svc.create(
        ctx(schoolId, ownerId),
        {
          studentId,
          name: "PTA waiver",
          feeItemId,
          duration: "LIFETIME",
          discountType: "FULL_WAIVER",
        },
        reqCtx,
      );

      const log = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { entityType: "discount_rule", entityId: rule.id },
          orderBy: { createdAt: "desc" },
        }),
      );
      expect(log).not.toBeNull();
      expect(log?.action).toBe("discount-rule.create");
      expect(log?.userId).toBe(ownerId);
      expect(log?.ipAddress).toBe("127.0.0.1");
    });

    it("throws SCOPE_INVARIANT when both feeItemId and feeCategoryId are set", async () => {
      const { schoolId, ownerId } = await makeSchool("cr-both");
      const studentId = await makeStudent(schoolId, "cr-both");
      const catId = await makeFeeCategory(schoolId, ownerId, "Both");
      const feeItemId = await makeFeeItem(schoolId, catId, ownerId);

      await expect(
        svc.create(
          ctx(schoolId, ownerId),
          {
            studentId,
            name: "Invalid",
            feeItemId,
            feeCategoryId: catId,
            duration: "LIFETIME",
            discountType: "FULL_WAIVER",
          },
          reqCtx,
        ),
      ).rejects.toThrow(ValidationError);
    });

    it("throws SCOPE_INVARIANT when neither feeItemId nor feeCategoryId is set", async () => {
      const { schoolId, ownerId } = await makeSchool("cr-none");
      const studentId = await makeStudent(schoolId, "cr-none");

      await expect(
        svc.create(
          ctx(schoolId, ownerId),
          {
            studentId,
            name: "Invalid",
            duration: "LIFETIME",
            discountType: "FULL_WAIVER",
          },
          reqCtx,
        ),
      ).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError when studentId belongs to another school", async () => {
      const { schoolId: schoolA, ownerId: ownerA } = await makeSchool("cr-st-a");
      const { schoolId: schoolB } = await makeSchool("cr-st-b");
      const studentFromB = await makeStudent(schoolB, "cr-st-b");
      const catId = await makeFeeCategory(schoolA, ownerA, "Tuition A");
      const feeItemId = await makeFeeItem(schoolA, catId, ownerA);

      await expect(
        svc.create(
          ctx(schoolA, ownerA),
          {
            studentId: studentFromB,
            name: "Cross-tenant attempt",
            feeItemId,
            duration: "LIFETIME",
            discountType: "FULL_WAIVER",
          },
          reqCtx,
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it("throws NotFoundError when feeItemId belongs to another school", async () => {
      const { schoolId: schoolA, ownerId: ownerA } = await makeSchool("cr-fi-a");
      const { schoolId: schoolB, ownerId: ownerB } = await makeSchool("cr-fi-b");
      const studentId = await makeStudent(schoolA, "cr-fi");
      const catB = await makeFeeCategory(schoolB, ownerB, "Tuition B");
      const feeItemFromB = await makeFeeItem(schoolB, catB, ownerB);

      await expect(
        svc.create(
          ctx(schoolA, ownerA),
          {
            studentId,
            name: "Cross-tenant item",
            feeItemId: feeItemFromB,
            duration: "LIFETIME",
            discountType: "FULL_WAIVER",
          },
          reqCtx,
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it("throws NotFoundError when feeCategoryId belongs to another school", async () => {
      const { schoolId: schoolA, ownerId: ownerA } = await makeSchool("cr-fc-a");
      const { schoolId: schoolB, ownerId: ownerB } = await makeSchool("cr-fc-b");
      const studentId = await makeStudent(schoolA, "cr-fc");
      const catFromB = await makeFeeCategory(schoolB, ownerB, "Cross Cat");

      await expect(
        svc.create(
          ctx(schoolA, ownerA),
          {
            studentId,
            name: "Cross-tenant category",
            feeCategoryId: catFromB,
            duration: "LIFETIME",
            discountType: "FULL_WAIVER",
          },
          reqCtx,
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it("throws SCOPE_NOT_FOUND when termId belongs to another school", async () => {
      const { schoolId: schoolA, ownerId: ownerA } = await makeSchool("cr-term-a");
      const { schoolId: schoolB } = await makeSchool("cr-term-b");
      const studentId = await makeStudent(schoolA, "cr-term");
      const catId = await makeFeeCategory(schoolA, ownerA, "Tuition Term");
      const feeItemId = await makeFeeItem(schoolA, catId, ownerA);
      const yearB = await makeAcademicYear(schoolB, "2025/2026-cr-term-b");
      const termFromB = await makeTerm(schoolB, yearB);

      await expect(
        svc.create(
          ctx(schoolA, ownerA),
          {
            studentId,
            name: "Bad term",
            feeItemId,
            duration: "TERM",
            termId: termFromB,
            discountType: "FULL_WAIVER",
          },
          reqCtx,
        ),
      ).rejects.toThrow(ValidationError);
    });
  });

  // ── findAll ───────────────────────────────────────────────────────────────

  describe("findAll", () => {
    it("returns only active rules by default and filters by studentId", async () => {
      const { schoolId, ownerId } = await makeSchool("fa-main");
      const student1 = await makeStudent(schoolId, "fa-s1");
      const student2 = await makeStudent(schoolId, "fa-s2");
      const catId = await makeFeeCategory(schoolId, ownerId, "FA Cat");
      const feeItemId = await makeFeeItem(schoolId, catId, ownerId);

      const rule1 = await svc.create(
        ctx(schoolId, ownerId),
        { studentId: student1, name: "R1", feeItemId, duration: "LIFETIME", discountType: "FULL_WAIVER" },
        reqCtx,
      );
      const rule2 = await svc.create(
        ctx(schoolId, ownerId),
        { studentId: student2, name: "R2", feeItemId, duration: "LIFETIME", discountType: "FULL_WAIVER" },
        reqCtx,
      );

      // Deactivate rule2
      await svc.deactivate(ctx(schoolId, ownerId), rule2.id, reqCtx);

      const all = await svc.findAll(ctx(schoolId, ownerId));
      expect(all.some((r) => r.id === rule1.id)).toBe(true);
      expect(all.some((r) => r.id === rule2.id)).toBe(false);

      const withInactive = await svc.findAll(ctx(schoolId, ownerId), { includeInactive: true });
      expect(withInactive.some((r) => r.id === rule2.id)).toBe(true);

      const byStudent = await svc.findAll(ctx(schoolId, ownerId), { studentId: student1 });
      expect(byStudent.every((r) => r.studentId === student1)).toBe(true);
      expect(byStudent.some((r) => r.studentId === student2)).toBe(false);
    });

    it("returns an empty array for another tenant's data", async () => {
      const { schoolId: schoolA, ownerId: ownerA } = await makeSchool("fa-iso-a");
      const { schoolId: schoolB } = await makeSchool("fa-iso-b");

      const studentA = await makeStudent(schoolA, "fa-iso-a");
      const catA = await makeFeeCategory(schoolA, ownerA, "FA ISO Cat");
      const feeItemA = await makeFeeItem(schoolA, catA, ownerA);

      await svc.create(
        ctx(schoolA, ownerA),
        { studentId: studentA, name: "A rule", feeItemId: feeItemA, duration: "LIFETIME", discountType: "FULL_WAIVER" },
        reqCtx,
      );

      // School B should see nothing from school A
      const { ownerId: ownerB } = await makeSchool("fa-iso-b2");
      const resultsFromB = await svc.findAll(ctx(schoolB, ownerB));
      expect(resultsFromB).toHaveLength(0);
    });
  });

  // ── findById ──────────────────────────────────────────────────────────────

  describe("findById", () => {
    it("returns the discount rule by id", async () => {
      const { schoolId, ownerId } = await makeSchool("fbi");
      const studentId = await makeStudent(schoolId, "fbi");
      const catId = await makeFeeCategory(schoolId, ownerId, "FBI Cat");
      const feeItemId = await makeFeeItem(schoolId, catId, ownerId);

      const rule = await svc.create(
        ctx(schoolId, ownerId),
        { studentId, name: "FBI Rule", feeItemId, duration: "LIFETIME", discountType: "FULL_WAIVER" },
        reqCtx,
      );

      const found = await svc.findById(ctx(schoolId, ownerId), rule.id);
      expect(found.id).toBe(rule.id);
      expect(found.name).toBe("FBI Rule");
    });

    it("throws NotFoundError for an unknown id", async () => {
      const { schoolId, ownerId } = await makeSchool("fbi-nf");
      await expect(
        svc.findById(ctx(schoolId, ownerId), "00000000-0000-0000-0000-000000000000"),
      ).rejects.toThrow(NotFoundError);
    });

    it("throws NotFoundError for a rule belonging to another school", async () => {
      const { schoolId: schoolA, ownerId: ownerA } = await makeSchool("fbi-iso-a");
      const { schoolId: schoolB, ownerId: ownerB } = await makeSchool("fbi-iso-b");
      const studentA = await makeStudent(schoolA, "fbi-iso");
      const catA = await makeFeeCategory(schoolA, ownerA, "FBI ISO Cat");
      const feeItemA = await makeFeeItem(schoolA, catA, ownerA);

      const ruleInA = await svc.create(
        ctx(schoolA, ownerA),
        { studentId: studentA, name: "A-only", feeItemId: feeItemA, duration: "LIFETIME", discountType: "FULL_WAIVER" },
        reqCtx,
      );

      await expect(
        svc.findById(ctx(schoolB, ownerB), ruleInA.id),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe("update", () => {
    it("updates the name and value", async () => {
      const { schoolId, ownerId } = await makeSchool("upd");
      const studentId = await makeStudent(schoolId, "upd");
      const catId = await makeFeeCategory(schoolId, ownerId, "UPD Cat");
      const feeItemId = await makeFeeItem(schoolId, catId, ownerId);
      const yearId = await makeAcademicYear(schoolId, "2025/2026-upd");
      const termId = await makeTerm(schoolId, yearId);

      const rule = await svc.create(
        ctx(schoolId, ownerId),
        {
          studentId,
          name: "Old name",
          feeItemId,
          duration: "TERM",
          termId,
          discountType: "PERCENTAGE",
          value: 500,
        },
        reqCtx,
      );

      const updated = await svc.update(ctx(schoolId, ownerId), rule.id, { name: "New name", value: 1500 }, reqCtx);
      expect(updated.name).toBe("New name");
      expect(updated.value).toBe(1500);
      // Immutable fields unchanged
      expect(updated.discountType).toBe("PERCENTAGE");
      expect(updated.duration).toBe("TERM");
      expect(updated.studentId).toBe(studentId);
    });

    it("throws NotFoundError when the rule does not exist", async () => {
      const { schoolId, ownerId } = await makeSchool("upd-nf");
      await expect(
        svc.update(
          ctx(schoolId, ownerId),
          "00000000-0000-0000-0000-000000000000",
          { name: "Ghost" },
          reqCtx,
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ── deactivate ────────────────────────────────────────────────────────────

  describe("deactivate", () => {
    it("sets active to false and preserves the row", async () => {
      const { schoolId, ownerId } = await makeSchool("deact");
      const studentId = await makeStudent(schoolId, "deact");
      const catId = await makeFeeCategory(schoolId, ownerId, "Deact Cat");
      const feeItemId = await makeFeeItem(schoolId, catId, ownerId);

      const rule = await svc.create(
        ctx(schoolId, ownerId),
        { studentId, name: "To deactivate", feeItemId, duration: "LIFETIME", discountType: "FULL_WAIVER" },
        reqCtx,
      );
      expect(rule.active).toBe(true);

      await svc.deactivate(ctx(schoolId, ownerId), rule.id, reqCtx);

      const withInactive = await svc.findAll(ctx(schoolId, ownerId), { includeInactive: true });
      const deactivated = withInactive.find((r) => r.id === rule.id);
      expect(deactivated).toBeDefined();
      expect(deactivated?.active).toBe(false);
    });

    it("writes an audit log entry on deactivate", async () => {
      const { schoolId, ownerId } = await makeSchool("deact-audit");
      const studentId = await makeStudent(schoolId, "deact-audit");
      const catId = await makeFeeCategory(schoolId, ownerId, "Deact Audit Cat");
      const feeItemId = await makeFeeItem(schoolId, catId, ownerId);

      const rule = await svc.create(
        ctx(schoolId, ownerId),
        { studentId, name: "Deact audit", feeItemId, duration: "LIFETIME", discountType: "FULL_WAIVER" },
        reqCtx,
      );
      await svc.deactivate(ctx(schoolId, ownerId), rule.id, reqCtx);

      const log = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { entityType: "discount_rule", entityId: rule.id, action: "discount-rule.deactivate" },
        }),
      );
      expect(log).not.toBeNull();
      expect(log?.userId).toBe(ownerId);
    });

    it("throws NotFoundError when the rule does not exist", async () => {
      const { schoolId, ownerId } = await makeSchool("deact-nf");
      await expect(
        svc.deactivate(ctx(schoolId, ownerId), "00000000-0000-0000-0000-000000000000", reqCtx),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
