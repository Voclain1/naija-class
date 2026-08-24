import { describe, expect, it } from "vitest";
import { mayPersistQuery } from "./persist-policy";

describe("mobile persisted-query security policy", () => {
  it("rejects every staff key even when a caller forgets meta.persist=false", () => {
    expect(mayPersistQuery(["staff", "school-a", "user-a", "dashboard"])).toBe(false);
  });

  it("rejects explicit non-persistence independently of the key prefix", () => {
    expect(mayPersistQuery(["guardian", "school-a", "guardian-a", "children"], { persist: false })).toBe(false);
  });

  it("keeps approved guardian/student reads eligible and credentials ineligible", () => {
    expect(mayPersistQuery(["guardian", "school-a", "guardian-a", "children"])).toBe(true);
    expect(mayPersistQuery(["student", "school-a", "student-a", "results"])).toBe(true);
    expect(mayPersistQuery(["guardian", "auth-token"])).toBe(false);
  });
});
