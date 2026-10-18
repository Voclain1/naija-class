import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  parsePlanEnforcement,
  planFeatureAvailable,
  planIncludesFeature,
  planUsageStatus,
  studentCapFor,
} from "@school-kit/types";

import { assertPlanFeature, assertRoomForStudents, readSchoolPlan } from "./plan-limits";

// Plans and student caps (2026-10-11, docs/modules/plans.md). The rules are
// pure and in @school-kit/types; the count runs against a real database under
// the school's RLS, which is what decides who counts.

describe("plan rules", () => {
  it("takes the override over the plan, and Enterprise without one has no cap", () => {
    expect(studentCapFor("FREE", null)).toBe(100);
    expect(studentCapFor("GROWTH", null)).toBe(600);
    expect(studentCapFor("FREE", 150)).toBe(150);
    expect(studentCapFor("ENTERPRISE", null)).toBeNull();
    expect(studentCapFor("ENTERPRISE", 3000)).toBe(3000);
  });

  it("is near at 90% of the cap and over only past it", () => {
    expect(planUsageStatus(89, 100)).toBe("ok");
    expect(planUsageStatus(90, 100)).toBe("near");
    expect(planUsageStatus(100, 100)).toBe("near");
    expect(planUsageStatus(101, 100)).toBe("over");
    expect(planUsageStatus(5000, null)).toBe("ok");
  });

  it("includes each report-card feature from Starter up, and grants them all under warn", () => {
    expect(planIncludesFeature("FREE", "reportCardBranding")).toBe(false);
    expect(planIncludesFeature("STARTER", "aiReportComments")).toBe(true);
    expect(planIncludesFeature("ENTERPRISE", "reportCardPositions")).toBe(true);
    expect(planFeatureAvailable("FREE", "reportCardPositions", "warn")).toBe(true);
    expect(planFeatureAvailable("FREE", "reportCardPositions", "enforce")).toBe(false);
  });

  it("enforces only when told to, exactly", () => {
    expect(parsePlanEnforcement(undefined)).toBe("warn");
    expect(parsePlanEnforcement("")).toBe("warn");
    expect(parsePlanEnforcement("block")).toBe("warn");
    expect(parsePlanEnforcement(" Enforce ")).toBe("enforce");
  });
});

describe("plan limits against the database", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolId: string;

  beforeAll(async () => {
    const school = await basePrisma.school.create({
      data: { name: `Plans ${runId}`, slug: `plans-${runId}`, studentCapOverride: 3 },
      select: { id: true },
    });
    schoolId = school.id;
    const statuses = ["ACTIVE", "INACTIVE", "SUSPENDED", "WITHDRAWN", "GRADUATED"] as const;
    await withTenant(schoolId, async (db) => {
      for (const [i, status] of statuses.entries()) {
        await db.student.create({
          data: {
            schoolId,
            admissionNumber: `PL/${runId}/${i}`,
            firstName: "Plan",
            lastName: `Student${i}`,
            dateOfBirth: new Date(Date.UTC(2014, 0, 1)),
            gender: "FEMALE",
            status,
          },
        });
      }
    });
  });

  afterAll(async () => {
    await withTenant(schoolId, (db) => db.student.deleteMany({ where: { schoolId } }));
    await basePrisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
  });

  it("counts students on the roll only, and reports the plan", async () => {
    const plan = await withTenant(schoolId, (db) => readSchoolPlan(db, schoolId, "warn"));
    expect(plan).toEqual({
      plan: "FREE",
      label: "Free",
      studentCap: 3,
      studentsOnRoll: 3,
      enforcement: "warn",
      status: "near",
      features: [
        { feature: "reportCardBranding", label: "Your logo and colours on report cards", included: false, available: true },
        { feature: "aiReportComments", label: "AI drafts of report card comments", included: false, available: true },
        {
          feature: "reportCardPositions",
          label: "Class positions and cumulative results on report cards",
          included: false,
          available: true,
        },
        { feature: "aiMarkingFeedback", label: "AI drafts of marking feedback", included: false, available: true },
      ],
      announcementEmailsPerDay: 200,
    });
    // Under enforce, a Free school has none of them.
    const enforced = await withTenant(schoolId, (db) => readSchoolPlan(db, schoolId, "enforce"));
    expect(enforced.features.map((f) => f.available)).toEqual([false, false, false, false]);
  });

  it("a feature is refused only under enforce, and only below its plan", async () => {
    await expect(withTenant(schoolId, (db) => assertPlanFeature(db, schoolId, "aiReportComments", "warn"))).resolves.toBeUndefined();
    await expect(withTenant(schoolId, (db) => assertPlanFeature(db, schoolId, "aiReportComments", "enforce"))).rejects.toMatchObject({
      code: "PLAN_FEATURE_UNAVAILABLE",
      httpStatus: 403,
      details: { feature: "aiReportComments", plan: "FREE" },
    });
    await basePrisma.school.update({ where: { id: schoolId }, data: { plan: "STARTER" } });
    try {
      await expect(withTenant(schoolId, (db) => assertPlanFeature(db, schoolId, "aiReportComments", "enforce"))).resolves.toBeUndefined();
    } finally {
      await basePrisma.school.update({ where: { id: schoolId }, data: { plan: "FREE" } });
    }
  });

  it("under warn, never refuses", async () => {
    await expect(withTenant(schoolId, (db) => assertRoomForStudents(db, schoolId, 50, "warn"))).resolves.toBeUndefined();
  });

  it("under enforce, refuses past the cap and says how much room is left", async () => {
    await basePrisma.school.update({ where: { id: schoolId }, data: { studentCapOverride: 5 } });
    await expect(withTenant(schoolId, (db) => assertRoomForStudents(db, schoolId, 2, "enforce"))).resolves.toBeUndefined();
    const refused = withTenant(schoolId, (db) => assertRoomForStudents(db, schoolId, 3, "enforce"));
    await expect(refused).rejects.toMatchObject({
      code: "PLAN_STUDENT_LIMIT",
      httpStatus: 403,
      details: { plan: "FREE", studentCap: 5, studentsOnRoll: 3, adding: 3 },
    });
    await expect(refused).rejects.toThrow(/room for 2 more, not 3/);
  });

  it("under enforce, an Enterprise school with no override has no cap", async () => {
    await basePrisma.school.update({ where: { id: schoolId }, data: { plan: "ENTERPRISE", studentCapOverride: null } });
    await expect(withTenant(schoolId, (db) => assertRoomForStudents(db, schoolId, 10_000, "enforce"))).resolves.toBeUndefined();
  });
});
