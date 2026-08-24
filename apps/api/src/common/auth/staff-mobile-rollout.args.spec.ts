import { describe, expect, it } from "vitest";
import { parseStaffMobileRolloutArgs } from "./staff-mobile-rollout.args";

describe("staff mobile one-school rollout rail", () => {
  it("accepts a one-school dry run", () => {
    expect(parseStaffMobileRolloutArgs(["--school-id", "school-a"])).toEqual({
      schoolId: "school-a", enabled: true, apply: false,
    });
  });
  it("rejects zero or multiple schools", () => {
    expect(() => parseStaffMobileRolloutArgs([])).toThrow("exactly one");
    expect(() => parseStaffMobileRolloutArgs(["--school-id", "a", "--school-id", "b"])).toThrow("exactly one");
  });
  it("requires exact repeated confirmation before apply", () => {
    expect(() => parseStaffMobileRolloutArgs(["--school-id", "a", "--apply"])).toThrow("matching");
    expect(() => parseStaffMobileRolloutArgs(["--school-id", "a", "--apply", "--confirm-school-id", "b"])).toThrow("matching");
    expect(parseStaffMobileRolloutArgs(["--school-id", "a", "--apply", "--confirm-school-id", "a"])).toMatchObject({ apply: true });
  });
});
