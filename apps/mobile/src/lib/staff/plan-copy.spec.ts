import { describe, expect, it } from "vitest";

import type { SchoolPlanDto } from "@school-kit/types";

import { planConsequenceSentence, planUsageSentence } from "./plan-copy";

const plan = (over: Partial<SchoolPlanDto>): SchoolPlanDto => ({
  plan: "FREE",
  label: "Free",
  studentCap: 100,
  studentsOnRoll: 40,
  enforcement: "warn",
  status: "ok",
  features: [],
  announcementEmailsPerDay: 200,
  ...over,
});

describe("plan copy", () => {
  it("says where the school is against its cap", () => {
    expect(planUsageSentence(plan({}))).toBe("Your school has 40 of the 100 students its Free plan covers.");
    expect(planUsageSentence(plan({ studentsOnRoll: 1200, studentCap: 1000, status: "over" }))).toBe(
      "Your school has 1,200 students on the roll, more than the 1,000 its Free plan covers.",
    );
    expect(planUsageSentence(plan({ plan: "ENTERPRISE", label: "Enterprise", studentCap: null, studentsOnRoll: 2500 }))).toBe(
      "Your school is on the Enterprise plan, with no limit on students. 2,500 are on the roll.",
    );
  });

  it("says nothing more while there is room", () => {
    expect(planConsequenceSentence(plan({}))).toBeNull();
  });

  it("during early access, says nothing is blocked", () => {
    expect(planConsequenceSentence(plan({ status: "over" }))).toMatch(/nothing is blocked/);
    expect(planConsequenceSentence(plan({ status: "near" }))).toMatch(/nothing is blocked/);
  });

  it("once enforced, says what will be refused", () => {
    expect(planConsequenceSentence(plan({ enforcement: "enforce", status: "near", studentsOnRoll: 95 }))).toBe(
      "Once you reach 100, new students can't be added until your plan changes.",
    );
    expect(planConsequenceSentence(plan({ enforcement: "enforce", status: "over" }))).toMatch(/can't be added/);
  });
});
