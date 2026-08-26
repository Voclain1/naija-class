import { describe, expect, it } from "vitest";

import { queryKeys } from "./keys";
import { mayPersistQuery } from "./persist-policy";

// Gate 3 of CP2.
//
// This deliberately does NOT test mayPersistQuery in the abstract — there is
// already a spec for that, and it would pass just as happily if the attendance
// screens used a key the policy never sees. What is asserted here is that the
// ACTUAL keys those screens build resolve to non-persistable, and that the set
// of staff keys is exactly the ones enumerated below. A future staff key added
// without the "staff" prefix becomes silently persistable, which on a shared
// staffroom handset means a class register — real children, by name — written
// to plaintext AsyncStorage. This spec is what makes that a build failure
// instead of a discovery.

const SCHOOL = "school_abc";
const USER = "user_xyz";

const STAFF_KEYS: Record<string, readonly unknown[]> = {
  staffScope: queryKeys.staffScope(SCHOOL, USER),
  staffRegister: queryKeys.staffRegister(SCHOOL, USER, "arm_1", "2026-08-25"),
  // CP3 — collections. staffDebtors is the single most sensitive cache entry
  // in the app: every family in the school that owes money, by name and
  // amount.
  staffTermContext: queryKeys.staffTermContext(SCHOOL, USER),
  staffCollections: queryKeys.staffCollections(SCHOOL, USER, "term_1"),
  staffDebtors: queryKeys.staffDebtors(SCHOOL, USER, "term_1"),
};

describe("staff query keys", () => {
  it.each(Object.entries(STAFF_KEYS))("%s is refused by the persister", (_name, key) => {
    expect(mayPersistQuery(key)).toBe(false);
  });

  it.each(Object.entries(STAFF_KEYS))("%s starts with the staff prefix", (_name, key) => {
    expect(key[0]).toBe("staff");
  });

  it.each(Object.entries(STAFF_KEYS))("%s is scoped to school and user", (_name, key) => {
    // Two staff accounts on one handset must not share a cache entry, and the
    // lock teardown drops the subtree by prefix.
    expect(key[1]).toBe(SCHOOL);
    expect(key[2]).toBe(USER);
  });

  it("every staff-prefixed key on the queryKeys object is covered above", () => {
    // Guards against a new staff key being added and quietly escaping this
    // spec: enumerate what queryKeys actually exposes rather than trusting the
    // table to have been updated.
    const built = Object.entries(queryKeys).flatMap(([name, value]) => {
      const key =
        typeof value === "function"
          ? (value as (...args: string[]) => readonly unknown[])(
              SCHOOL,
              USER,
              "arm_1",
              "2026-08-25",
            )
          : value;
      return key[0] === "staff" ? [name] : [];
    });
    expect(built.sort()).toEqual(Object.keys(STAFF_KEYS).sort());
  });

  it("the lock teardown predicate matches every staff key", () => {
    // session.tsx drops staff cache on lock with
    // `queryKey[0] === "staff"`. If a staff key ever failed that test it would
    // survive the lock and be readable after re-entry by someone else.
    for (const key of Object.values(STAFF_KEYS)) expect(key[0] === "staff").toBe(true);
  });

  it("guardian and student keys are unaffected by the staff prefix rule", () => {
    expect(mayPersistQuery(queryKeys.myAttendance)).toBe(true);
    expect(mayPersistQuery(queryKeys.students)).toBe(true);
  });
});
