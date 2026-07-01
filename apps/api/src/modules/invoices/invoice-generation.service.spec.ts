import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { AuthService } from "../auth/auth.service.js";
import { InvoiceGenerationService } from "./invoice-generation.service.js";
import { buildSnapshot, computeRuleDiscount } from "./invoice-snapshot.js";

// Phase 3 / Slice 6 CP1 — invoice generation spec.
//
// Part 1 (describe "buildSnapshot"): pure-function unit tests — no DB.
//   Covers: fee-scope matching, discount computation (PERCENTAGE, FIXED_AMOUNT,
//   FULL_WAIVER), stacking, capping, basis-point integer arithmetic.
//
// Part 2 (describe "InvoiceGenerationService"): integration tests — real DB.
//   Covers: generateForArm (happy path, re-generate idempotency, empty arm),
//   previewForArm, findById, findAll, cancel (valid + rejection states).

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — pure-function unit tests (no DB)
// ─────────────────────────────────────────────────────────────────────────────

describe("computeRuleDiscount", () => {
  const base = { id: "r1", name: "Test", feeItemId: null, feeCategoryId: null };

  it("PERCENTAGE: 1000 bp on 15_000_000 kobo = 1_500_000 kobo (no float)", () => {
    const result = computeRuleDiscount(15_000_000, {
      ...base,
      discountType: "PERCENTAGE",
      value: 1000,
    });
    expect(result).toBe(1_500_000);
  });

  it("PERCENTAGE: truncates fractional kobo — Math.floor, never rounds up", () => {
    // 1 kobo * 3333 bp = 0.3333 → floor → 0
    expect(computeRuleDiscount(1, { ...base, discountType: "PERCENTAGE", value: 3333 })).toBe(0);
    // 3 kobo * 3333 bp = 0.9999 → floor → 0
    expect(computeRuleDiscount(3, { ...base, discountType: "PERCENTAGE", value: 3333 })).toBe(0);
    // 10000 kobo * 3333 bp = 3333 → exact
    expect(computeRuleDiscount(10_000, { ...base, discountType: "PERCENTAGE", value: 3333 })).toBe(3333);
  });

  it("PERCENTAGE: 9999 bp on 10_000 kobo = 9_999 kobo (max basis points)", () => {
    expect(computeRuleDiscount(10_000, { ...base, discountType: "PERCENTAGE", value: 9999 })).toBe(9999);
  });

  it("FIXED_AMOUNT: returns the raw value (kobo), not capped — capping is caller's job", () => {
    // Even if value > item amount, computeRuleDiscount returns the raw value.
    expect(
      computeRuleDiscount(100, { ...base, discountType: "FIXED_AMOUNT", value: 500 }),
    ).toBe(500);
  });

  it("FIXED_AMOUNT: returns value for typical case", () => {
    expect(
      computeRuleDiscount(15_000_000, { ...base, discountType: "FIXED_AMOUNT", value: 500_000 }),
    ).toBe(500_000);
  });

  it("FULL_WAIVER: always equals the item amount", () => {
    expect(computeRuleDiscount(5_000_000, { ...base, discountType: "FULL_WAIVER", value: null })).toBe(5_000_000);
    expect(computeRuleDiscount(1, { ...base, discountType: "FULL_WAIVER", value: null })).toBe(1);
  });
});

describe("buildSnapshot", () => {
  const tuitionCatId = "cat-tuition";
  const hostelfCatId = "cat-hostel";

  const tuitionItem: Parameters<typeof buildSnapshot>[0][0] = {
    id: "item-tuition",
    name: "Tuition Fee",
    amount: 15_000_000, // ₦150,000 in kobo
    categoryId: tuitionCatId,
    categoryName: "Tuition",
  };
  const hostelItem: Parameters<typeof buildSnapshot>[0][0] = {
    id: "item-hostel",
    name: "Hostel Fee",
    amount: 8_000_000, // ₦80,000 in kobo
    categoryId: hostelfCatId,
    categoryName: "Hostel",
  };

  it("no discount rules → totals equal sum of amounts, netAmount = amount", () => {
    const result = buildSnapshot([tuitionItem, hostelItem], []);
    expect(result.totalAmount).toBe(23_000_000);
    expect(result.totalDiscount).toBe(0);
    expect(result.totalDue).toBe(23_000_000);
    expect(result.items[0].netAmount).toBe(15_000_000);
    expect(result.items[1].netAmount).toBe(8_000_000);
  });

  it("empty fee items → all zeros", () => {
    const result = buildSnapshot([], []);
    expect(result.totalAmount).toBe(0);
    expect(result.totalDiscount).toBe(0);
    expect(result.totalDue).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it("feeItemId rule targets only the matching item", () => {
    const rule = {
      id: "r1",
      name: "Tuition 10% off",
      feeItemId: "item-tuition",
      feeCategoryId: null,
      discountType: "PERCENTAGE" as const,
      value: 1000,
    };
    const result = buildSnapshot([tuitionItem, hostelItem], [rule]);
    // Tuition: 10% of 15_000_000 = 1_500_000
    expect(result.items[0].discountsApplied).toHaveLength(1);
    expect(result.items[0].discountsApplied[0].discountAmount).toBe(1_500_000);
    expect(result.items[0].netAmount).toBe(13_500_000);
    // Hostel: unaffected
    expect(result.items[1].discountsApplied).toHaveLength(0);
    expect(result.items[1].netAmount).toBe(8_000_000);
    expect(result.totalDiscount).toBe(1_500_000);
    expect(result.totalDue).toBe(21_500_000);
  });

  it("feeCategoryId rule targets all items in that category", () => {
    const extraTuitionItem = { ...tuitionItem, id: "item-tuition-2", name: "Lab Fee" };
    const rule = {
      id: "r1",
      name: "Tuition category 10%",
      feeItemId: null,
      feeCategoryId: tuitionCatId,
      discountType: "PERCENTAGE" as const,
      value: 1000,
    };
    const result = buildSnapshot([tuitionItem, extraTuitionItem, hostelItem], [rule]);
    // Both tuition items get 10% off; hostel is unaffected
    expect(result.items[0].discountsApplied).toHaveLength(1);
    expect(result.items[1].discountsApplied).toHaveLength(1);
    expect(result.items[2].discountsApplied).toHaveLength(0);
    expect(result.totalDiscount).toBe(3_000_000); // 1_500_000 + 1_500_000
  });

  it("FULL_WAIVER on a category zeroes all items in that category", () => {
    const rule = {
      id: "r1",
      name: "Full hostel waiver",
      feeItemId: null,
      feeCategoryId: hostelfCatId,
      discountType: "FULL_WAIVER" as const,
      value: null,
    };
    const result = buildSnapshot([tuitionItem, hostelItem], [rule]);
    expect(result.items[0].netAmount).toBe(15_000_000); // tuition untouched
    expect(result.items[1].netAmount).toBe(0); // hostel fully waived
    expect(result.totalDiscount).toBe(8_000_000);
    expect(result.totalDue).toBe(15_000_000);
  });

  it("FIXED_AMOUNT deducted from the targeted item", () => {
    const rule = {
      id: "r1",
      name: "₦5,000 tuition reduction",
      feeItemId: "item-tuition",
      feeCategoryId: null,
      discountType: "FIXED_AMOUNT" as const,
      value: 500_000, // ₦5,000
    };
    const result = buildSnapshot([tuitionItem], [rule]);
    expect(result.items[0].netAmount).toBe(14_500_000);
    expect(result.totalDiscount).toBe(500_000);
  });

  it("multiple rules are additive — each computed against original amount, NOT a running remainder", () => {
    // Two 40% rules on the same item.
    // Wrong (sequential): 15_000_000 * 40% = 6_000_000 → 9_000_000 * 40% = 3_600_000 → total 9_600_000 discount
    // Correct (additive): 6_000_000 + 6_000_000 = 12_000_000, capped at 15_000_000 → netAmount = 3_000_000
    const rules = [
      { id: "r1", name: "40% A", feeItemId: "item-tuition", feeCategoryId: null, discountType: "PERCENTAGE" as const, value: 4000 },
      { id: "r2", name: "40% B", feeItemId: "item-tuition", feeCategoryId: null, discountType: "PERCENTAGE" as const, value: 4000 },
    ];
    const result = buildSnapshot([tuitionItem], rules);
    // Each rule: 15_000_000 * 4000 / 10000 = 6_000_000
    expect(result.items[0].discountsApplied[0].discountAmount).toBe(6_000_000);
    expect(result.items[0].discountsApplied[1].discountAmount).toBe(6_000_000);
    // Sum = 12_000_000; not capped (< 15_000_000)
    expect(result.items[0].netAmount).toBe(3_000_000);
    expect(result.totalDiscount).toBe(12_000_000);
  });

  it("stacked discounts that exceed item amount are capped — netAmount never goes below zero", () => {
    const rules = [
      { id: "r1", name: "60% A", feeItemId: "item-tuition", feeCategoryId: null, discountType: "PERCENTAGE" as const, value: 6000 },
      { id: "r2", name: "60% B", feeItemId: "item-tuition", feeCategoryId: null, discountType: "PERCENTAGE" as const, value: 6000 },
    ];
    const result = buildSnapshot([tuitionItem], rules);
    // Each: 9_000_000; sum = 18_000_000 > 15_000_000 → capped at 15_000_000
    expect(result.items[0].netAmount).toBe(0);
    expect(result.totalDiscount).toBe(15_000_000);
    expect(result.totalDue).toBe(0);
  });

  it("snapshot preserves feeItemId, categoryName, feeName in items", () => {
    const result = buildSnapshot([tuitionItem], []);
    expect(result.items[0].feeItemId).toBe("item-tuition");
    expect(result.items[0].categoryName).toBe("Tuition");
    expect(result.items[0].feeName).toBe("Tuition Fee");
    expect(result.items[0].amount).toBe(15_000_000);
  });

  it("totalDue = totalAmount − totalDiscount always", () => {
    const rule = {
      id: "r1",
      name: "10%",
      feeItemId: "item-tuition",
      feeCategoryId: null,
      discountType: "PERCENTAGE" as const,
      value: 1000,
    };
    const result = buildSnapshot([tuitionItem, hostelItem], [rule]);
    expect(result.totalDue).toBe(result.totalAmount - result.totalDiscount);
  });

  it("kobo arithmetic — all numbers are integers (no float drift)", () => {
    // 3333 bp on various amounts — verify all results are integers
    const checkRule = {
      id: "r1",
      name: "3333 bp",
      feeItemId: "item-tuition",
      feeCategoryId: null,
      discountType: "PERCENTAGE" as const,
      value: 3333,
    };
    const result = buildSnapshot([tuitionItem, hostelItem], [checkRule]);
    for (const item of result.items) {
      expect(Number.isInteger(item.amount)).toBe(true);
      expect(Number.isInteger(item.netAmount)).toBe(true);
      for (const d of item.discountsApplied) {
        expect(Number.isInteger(d.discountAmount)).toBe(true);
      }
    }
    expect(Number.isInteger(result.totalAmount)).toBe(true);
    expect(Number.isInteger(result.totalDiscount)).toBe(true);
    expect(Number.isInteger(result.totalDue)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — integration tests (real DB)
// ─────────────────────────────────────────────────────────────────────────────

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const r = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23492${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: null as string | null };

describe("InvoiceGenerationService (integration)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const svc = new InvoiceGenerationService();
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // ── Fixture helpers ────────────────────────────────────────────────────────

  async function makeSchool(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await auth.signupOwner(
      {
        schoolName: `Invoice ${suffix} ${runId}`,
        schoolSlug: `invoice-${suffix}-${runId}`,
        ownerFirstName: "Bisi",
        ownerLastName: "Owner",
        ownerEmail: `invoice-${suffix}-${runId}@example.test`,
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

  async function makeAcademicStructure(
    schoolId: string,
  ): Promise<{
    academicYearId: string;
    termId: string;
    classLevelId: string;
    classArmId: string;
  }> {
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `2025/2026-${runId}`,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
        select: { id: true },
      });
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
          sequence: 1,
          name: "First Term",
          startDate: new Date("2025-09-01"),
          endDate: new Date("2025-12-15"),
        },
        select: { id: true },
      });
      // classLevel is seeded by signupOwner (Phase 1 seed)
      const level = await db.classLevel.findFirst({
        where: { schoolId },
        select: { id: true },
      });
      if (!level) throw new Error("No class level — check signup seed");
      const arm = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: `Arm-${runId}`, code: `arm-${runId}` },
        select: { id: true },
      });
      return {
        academicYearId: year.id,
        termId: term.id,
        classLevelId: level.id,
        classArmId: arm.id,
      };
    });
  }

  async function enrollStudent(
    schoolId: string,
    studentId: string,
    classArmId: string,
    termId: string,
    academicYearId: string,
  ): Promise<void> {
    await withTenant(schoolId, async (db) => {
      await db.enrollment.create({
        data: {
          schoolId,
          studentId,
          classArmId,
          termId,
          academicYearId,
          status: "ENROLLED",
        },
      });
    });
  }

  async function makeStudent(schoolId: string, suffix: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const s = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `ADM-INV-${suffix}-${runId}`,
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

  async function makeFeeSetup(
    schoolId: string,
    ownerId: string,
    classLevelId: string,
    termId: string,
  ): Promise<{ catId: string; feeItemId: string }> {
    return withTenant(schoolId, async (db) => {
      const cat = await db.feeCategory.create({
        data: { schoolId, name: `Tuition-${runId}`, createdBy: ownerId },
        select: { id: true },
      });
      const item = await db.feeItem.create({
        data: {
          schoolId,
          categoryId: cat.id,
          name: "Term Tuition",
          amount: 15_000_000, // ₦150,000
          classLevelId, // scoped to this level
          termId,       // scoped to this term
          createdBy: ownerId,
        },
        select: { id: true },
      });
      return { catId: cat.id, feeItemId: item.id };
    });
  }

  // ── generateForArm ─────────────────────────────────────────────────────────

  describe("generateForArm", () => {
    it("creates one ISSUED invoice per enrolled student with correct snapshot", async () => {
      const { schoolId, ownerId } = await makeSchool("gen-happy");
      const { academicYearId, termId, classLevelId, classArmId } =
        await makeAcademicStructure(schoolId);
      const { catId: _catId, feeItemId } = await makeFeeSetup(schoolId, ownerId, classLevelId, termId);

      const studentId = await makeStudent(schoolId, "gen-happy-s1");
      await enrollStudent(schoolId, studentId, classArmId, termId, academicYearId);

      const result = await svc.generateForArm(
        ctx(schoolId, ownerId),
        { termId, classArmId },
        reqCtx,
      );

      expect(result.created).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.invoices).toHaveLength(1);

      const inv = result.invoices[0];
      expect(inv.status).toBe("ISSUED");
      expect(inv.studentId).toBe(studentId);
      expect(inv.termId).toBe(termId);
      expect(inv.academicYearId).toBe(academicYearId);
      expect(inv.totalAmount).toBe(15_000_000);
      expect(inv.totalDiscount).toBe(0);
      expect(inv.totalDue).toBe(15_000_000);
      expect(inv.totalPaid).toBe(0);
      expect(inv.items).toHaveLength(1);
      expect(inv.items[0].feeItemId).toBe(feeItemId);
      expect(inv.items[0].amount).toBe(15_000_000);
      expect(inv.items[0].netAmount).toBe(15_000_000);
      expect(inv.items[0].discountsApplied).toHaveLength(0);

      // Verify audit log was written
      const auditRow = await withTenant(schoolId, async (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "invoice.issue", entityId: inv.id },
          select: { entityId: true, metadata: true },
        }),
      );
      expect(auditRow).not.toBeNull();
    });

    it("applies an active PERCENTAGE discount rule for the student", async () => {
      const { schoolId, ownerId } = await makeSchool("gen-pct");
      const { academicYearId, termId, classLevelId, classArmId } =
        await makeAcademicStructure(schoolId);
      const { catId: _catId, feeItemId } = await makeFeeSetup(schoolId, ownerId, classLevelId, termId);

      const studentId = await makeStudent(schoolId, "gen-pct-s1");
      await enrollStudent(schoolId, studentId, classArmId, termId, academicYearId);

      // 10% off the fee item for this term
      await withTenant(schoolId, async (db) => {
        await db.discountRule.create({
          data: {
            schoolId,
            studentId,
            name: "10% scholarship",
            feeItemId,
            duration: "TERM",
            termId,
            discountType: "PERCENTAGE",
            value: 1000, // 1000 bp = 10%
            createdBy: ownerId,
          },
        });
      });

      const result = await svc.generateForArm(
        ctx(schoolId, ownerId),
        { termId, classArmId },
        reqCtx,
      );

      const inv = result.invoices[0];
      expect(inv.totalDiscount).toBe(1_500_000); // 10% of ₦150,000
      expect(inv.totalDue).toBe(13_500_000);
      expect(inv.items[0].discountsApplied).toHaveLength(1);
      expect(inv.items[0].discountsApplied[0].discountAmount).toBe(1_500_000);
      expect(inv.items[0].netAmount).toBe(13_500_000);
    });

    it("applies FULL_WAIVER discount — netAmount = 0 for that item", async () => {
      const { schoolId, ownerId } = await makeSchool("gen-waiver");
      const { academicYearId, termId, classLevelId, classArmId } =
        await makeAcademicStructure(schoolId);
      const { catId: _catId, feeItemId } = await makeFeeSetup(schoolId, ownerId, classLevelId, termId);

      const studentId = await makeStudent(schoolId, "gen-waiver-s1");
      await enrollStudent(schoolId, studentId, classArmId, termId, academicYearId);

      await withTenant(schoolId, async (db) => {
        await db.discountRule.create({
          data: {
            schoolId,
            studentId,
            name: "Staff child waiver",
            feeItemId,
            duration: "LIFETIME",
            discountType: "FULL_WAIVER",
            value: null,
            createdBy: ownerId,
          },
        });
      });

      const result = await svc.generateForArm(
        ctx(schoolId, ownerId),
        { termId, classArmId },
        reqCtx,
      );

      const inv = result.invoices[0];
      expect(inv.totalDiscount).toBe(15_000_000);
      expect(inv.totalDue).toBe(0);
      expect(inv.items[0].netAmount).toBe(0);
    });

    it("LIFETIME discount rule applies regardless of termId / academicYearId", async () => {
      const { schoolId, ownerId } = await makeSchool("gen-lifetime");
      const { academicYearId, termId, classLevelId, classArmId } =
        await makeAcademicStructure(schoolId);
      const { catId: _catId, feeItemId } = await makeFeeSetup(schoolId, ownerId, classLevelId, termId);

      const studentId = await makeStudent(schoolId, "gen-lifetime-s1");
      await enrollStudent(schoolId, studentId, classArmId, termId, academicYearId);

      await withTenant(schoolId, async (db) => {
        await db.discountRule.create({
          data: {
            schoolId,
            studentId,
            name: "Lifetime 20% discount",
            feeItemId,
            duration: "LIFETIME",
            discountType: "PERCENTAGE",
            value: 2000, // 20%
            createdBy: ownerId,
          },
        });
      });

      const result = await svc.generateForArm(
        ctx(schoolId, ownerId),
        { termId, classArmId },
        reqCtx,
      );

      expect(result.invoices[0].totalDiscount).toBe(3_000_000); // 20% of 15_000_000
    });

    it("SESSION discount rule matches academicYearId, not termId", async () => {
      const { schoolId, ownerId } = await makeSchool("gen-session");
      const { academicYearId, termId, classLevelId, classArmId } =
        await makeAcademicStructure(schoolId);
      const { catId: _catId, feeItemId } = await makeFeeSetup(schoolId, ownerId, classLevelId, termId);

      const studentId = await makeStudent(schoolId, "gen-session-s1");
      await enrollStudent(schoolId, studentId, classArmId, termId, academicYearId);

      await withTenant(schoolId, async (db) => {
        await db.discountRule.create({
          data: {
            schoolId,
            studentId,
            name: "Session 15%",
            feeItemId,
            duration: "SESSION",
            academicYearId,
            discountType: "PERCENTAGE",
            value: 1500, // 15%
            createdBy: ownerId,
          },
        });
      });

      const result = await svc.generateForArm(
        ctx(schoolId, ownerId),
        { termId, classArmId },
        reqCtx,
      );

      expect(result.invoices[0].totalDiscount).toBe(2_250_000); // 15% of 15_000_000
    });

    it("TERM discount rule for a DIFFERENT term is not applied", async () => {
      const { schoolId, ownerId } = await makeSchool("gen-term-miss");
      const { academicYearId, termId, classLevelId, classArmId } =
        await makeAcademicStructure(schoolId);
      const { catId: _catId, feeItemId } = await makeFeeSetup(schoolId, ownerId, classLevelId, termId);

      // Create a second term so we have a different termId
      const otherTermId = await withTenant(schoolId, async (db) => {
        const t = await db.term.create({
          data: {
            schoolId,
            academicYearId,
            sequence: 2,
            name: "Second Term",
            startDate: new Date("2026-01-05"),
            endDate: new Date("2026-04-10"),
          },
          select: { id: true },
        });
        return t.id;
      });

      const studentId = await makeStudent(schoolId, "gen-term-miss-s1");
      await enrollStudent(schoolId, studentId, classArmId, termId, academicYearId);

      await withTenant(schoolId, async (db) => {
        await db.discountRule.create({
          data: {
            schoolId,
            studentId,
            name: "10% for SECOND term only",
            feeItemId,
            duration: "TERM",
            termId: otherTermId, // different term
            discountType: "PERCENTAGE",
            value: 1000,
            createdBy: ownerId,
          },
        });
      });

      const result = await svc.generateForArm(
        ctx(schoolId, ownerId),
        { termId, classArmId }, // first term
        reqCtx,
      );

      // Rule for second term should not apply
      expect(result.invoices[0].totalDiscount).toBe(0);
    });

    it("deactivated discount rule is not applied", async () => {
      const { schoolId, ownerId } = await makeSchool("gen-inactive");
      const { academicYearId, termId, classLevelId, classArmId } =
        await makeAcademicStructure(schoolId);
      const { catId: _catId, feeItemId } = await makeFeeSetup(schoolId, ownerId, classLevelId, termId);

      const studentId = await makeStudent(schoolId, "gen-inactive-s1");
      await enrollStudent(schoolId, studentId, classArmId, termId, academicYearId);

      await withTenant(schoolId, async (db) => {
        await db.discountRule.create({
          data: {
            schoolId,
            studentId,
            name: "10% (inactive)",
            feeItemId,
            duration: "LIFETIME",
            discountType: "PERCENTAGE",
            value: 1000,
            active: false, // deactivated
            createdBy: ownerId,
          },
        });
      });

      const result = await svc.generateForArm(
        ctx(schoolId, ownerId),
        { termId, classArmId },
        reqCtx,
      );

      expect(result.invoices[0].totalDiscount).toBe(0);
    });

    it("fee item with non-matching level scope is excluded", async () => {
      const { schoolId, ownerId } = await makeSchool("gen-scope-level");
      const { academicYearId, termId, classLevelId: _classLevelId, classArmId } =
        await makeAcademicStructure(schoolId);

      // Fee item scoped to a DIFFERENT class level
      const anotherLevelId = await withTenant(schoolId, async (db) => {
        const l = await db.classLevel.create({
          data: { schoolId, name: "JSS2-extra", code: `jss2-extra-${runId}`, stage: "JSS", orderIndex: 99 },
          select: { id: true },
        });
        return l.id;
      });

      await withTenant(schoolId, async (db) => {
        const cat = await db.feeCategory.create({
          data: { schoolId, name: `WrongLevel-${runId}`, createdBy: ownerId },
          select: { id: true },
        });
        await db.feeItem.create({
          data: {
            schoolId,
            categoryId: cat.id,
            name: "JSS2 Tuition",
            amount: 15_000_000,
            classLevelId: anotherLevelId, // scoped to JSS2 — NOT our arm's level
            createdBy: ownerId,
          },
        });
      });

      const studentId = await makeStudent(schoolId, "gen-scope-level-s1");
      await enrollStudent(schoolId, studentId, classArmId, termId, academicYearId);

      const result = await svc.generateForArm(
        ctx(schoolId, ownerId),
        { termId, classArmId },
        reqCtx,
      );

      // No fee item matches — invoice created with zero totals
      expect(result.created).toBe(1);
      expect(result.invoices[0].totalAmount).toBe(0);
      expect(result.invoices[0].items).toHaveLength(0);
    });

    it("re-generate skips students who already have an invoice for that term", async () => {
      const { schoolId, ownerId } = await makeSchool("gen-idempotent");
      const { academicYearId, termId, classLevelId, classArmId } =
        await makeAcademicStructure(schoolId);
      await makeFeeSetup(schoolId, ownerId, classLevelId, termId);

      const studentId = await makeStudent(schoolId, "gen-idempotent-s1");
      await enrollStudent(schoolId, studentId, classArmId, termId, academicYearId);

      const first = await svc.generateForArm(ctx(schoolId, ownerId), { termId, classArmId }, reqCtx);
      expect(first.created).toBe(1);

      const second = await svc.generateForArm(ctx(schoolId, ownerId), { termId, classArmId }, reqCtx);
      expect(second.created).toBe(0);
      expect(second.skipped).toBe(1);
      expect(second.invoices).toHaveLength(0);
    });

    it("returns created:0, skipped:0 for an arm with no enrolled students", async () => {
      const { schoolId, ownerId } = await makeSchool("gen-empty");
      const { termId, classLevelId, classArmId } = await makeAcademicStructure(schoolId);
      await makeFeeSetup(schoolId, ownerId, classLevelId, termId);

      const result = await svc.generateForArm(
        ctx(schoolId, ownerId),
        { termId, classArmId },
        reqCtx,
      );

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it("throws NotFoundError when classArmId does not belong to the school", async () => {
      const { schoolId, ownerId } = await makeSchool("gen-wrong-arm");
      const { termId } = await makeAcademicStructure(schoolId);

      await expect(
        svc.generateForArm(
          ctx(schoolId, ownerId),
          { termId, classArmId: "00000000-0000-0000-0000-000000000000" },
          reqCtx,
        ),
      ).rejects.toThrow("Class arm not found.");
    });

    it("cross-tenant: school B cannot see school A invoice via findById", async () => {
      const { schoolId: schoolA, ownerId: ownerA } = await makeSchool("gen-ct-a");
      const { schoolId: schoolB, ownerId: ownerB } = await makeSchool("gen-ct-b");

      const { academicYearId, termId, classLevelId, classArmId } =
        await makeAcademicStructure(schoolA);
      await makeFeeSetup(schoolA, ownerA, classLevelId, termId);
      const studentId = await makeStudent(schoolA, "gen-ct-a-s1");
      await enrollStudent(schoolA, studentId, classArmId, termId, academicYearId);

      const result = await svc.generateForArm(ctx(schoolA, ownerA), { termId, classArmId }, reqCtx);
      const invoiceId = result.invoices[0].id;

      // School B tries to read school A's invoice
      await expect(svc.findById(ctx(schoolB, ownerB), invoiceId)).rejects.toThrow("Invoice not found.");
    });
  });

  // ── previewForArm ──────────────────────────────────────────────────────────

  describe("previewForArm", () => {
    it("returns preview lines per enrolled student without persisting invoices", async () => {
      const { schoolId, ownerId } = await makeSchool("preview-happy");
      const { academicYearId, termId, classLevelId, classArmId } =
        await makeAcademicStructure(schoolId);
      await makeFeeSetup(schoolId, ownerId, classLevelId, termId);

      const studentId = await makeStudent(schoolId, "preview-s1");
      await enrollStudent(schoolId, studentId, classArmId, termId, academicYearId);

      const preview = await svc.previewForArm(ctx(schoolId, ownerId), { termId, classArmId });

      expect(preview).toHaveLength(1);
      expect(preview[0].studentId).toBe(studentId);
      expect(preview[0].totalAmount).toBe(15_000_000);
      expect(preview[0].totalDiscount).toBe(0);
      expect(preview[0].totalDue).toBe(15_000_000);
      expect(preview[0].feeItemCount).toBe(1);

      // No invoice should have been created
      const invoices = await svc.findAll(ctx(schoolId, ownerId), {
        termId,
        page: 1,
        limit: 10,
      });
      expect(invoices.total).toBe(0);
    });
  });

  // ── cancel ─────────────────────────────────────────────────────────────────

  describe("cancel", () => {
    it("cancels an ISSUED invoice", async () => {
      const { schoolId, ownerId } = await makeSchool("cancel-issued");
      const { academicYearId, termId, classLevelId, classArmId } =
        await makeAcademicStructure(schoolId);
      await makeFeeSetup(schoolId, ownerId, classLevelId, termId);

      const studentId = await makeStudent(schoolId, "cancel-issued-s1");
      await enrollStudent(schoolId, studentId, classArmId, termId, academicYearId);

      const { invoices } = await svc.generateForArm(ctx(schoolId, ownerId), { termId, classArmId }, reqCtx);
      const invoiceId = invoices[0].id;

      const cancelled = await svc.cancel(ctx(schoolId, ownerId), invoiceId, reqCtx);
      expect(cancelled.status).toBe("CANCELLED");

      const auditRow = await withTenant(schoolId, async (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "invoice.cancel", entityId: invoiceId },
          select: { entityId: true },
        }),
      );
      expect(auditRow).not.toBeNull();
    });

    it("rejects cancel of an already-cancelled invoice with ConflictError", async () => {
      const { schoolId, ownerId } = await makeSchool("cancel-dupe");
      const { academicYearId, termId, classLevelId, classArmId } =
        await makeAcademicStructure(schoolId);
      await makeFeeSetup(schoolId, ownerId, classLevelId, termId);

      const studentId = await makeStudent(schoolId, "cancel-dupe-s1");
      await enrollStudent(schoolId, studentId, classArmId, termId, academicYearId);

      const { invoices } = await svc.generateForArm(ctx(schoolId, ownerId), { termId, classArmId }, reqCtx);
      const invoiceId = invoices[0].id;

      await svc.cancel(ctx(schoolId, ownerId), invoiceId, reqCtx);

      await expect(svc.cancel(ctx(schoolId, ownerId), invoiceId, reqCtx)).rejects.toMatchObject({
        code: "INVOICE_ALREADY_CANCELLED",
      });
    });

    it("throws NotFoundError for non-existent invoice id", async () => {
      const { schoolId, ownerId } = await makeSchool("cancel-notfound");
      await expect(
        svc.cancel(ctx(schoolId, ownerId), "00000000-0000-0000-0000-000000000000", reqCtx),
      ).rejects.toThrow("Invoice not found.");
    });
  });

  // ── findAll / findById ─────────────────────────────────────────────────────

  describe("findAll", () => {
    it("filters by termId and paginates correctly", async () => {
      const { schoolId, ownerId } = await makeSchool("list-filter");
      const { academicYearId, termId, classLevelId, classArmId } =
        await makeAcademicStructure(schoolId);
      await makeFeeSetup(schoolId, ownerId, classLevelId, termId);

      const s1 = await makeStudent(schoolId, "list-filter-s1");
      const s2 = await makeStudent(schoolId, "list-filter-s2");
      await enrollStudent(schoolId, s1, classArmId, termId, academicYearId);
      await enrollStudent(schoolId, s2, classArmId, termId, academicYearId);

      await svc.generateForArm(ctx(schoolId, ownerId), { termId, classArmId }, reqCtx);

      const page1 = await svc.findAll(ctx(schoolId, ownerId), { termId, page: 1, limit: 1 });
      expect(page1.total).toBe(2);
      expect(page1.data).toHaveLength(1);

      const page2 = await svc.findAll(ctx(schoolId, ownerId), { termId, page: 2, limit: 1 });
      expect(page2.data).toHaveLength(1);
    });
  });
});
