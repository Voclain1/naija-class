import { describe, expect, it } from "vitest";

import { readStoredPrincipal } from "./principal";

// The rule this guards is a compatibility rule, and compatibility rules are
// exactly the ones that get "simplified" later by someone who does not know
// why they are there. The interesting cases are all the ones that are NOT
// "student".
describe("readStoredPrincipal", () => {
  it("reads a stored student principal", () => {
    expect(readStoredPrincipal("student")).toBe("student");
  });

  it("reads a stored guardian principal", () => {
    expect(readStoredPrincipal("guardian")).toBe("guardian");
  });

  it("reads a stored staff principal without treating a role as a principal", () => {
    expect(readStoredPrincipal("staff")).toBe("staff");
    expect(readStoredPrincipal("teacher")).toBe("guardian");
    expect(readStoredPrincipal("bursar")).toBe("guardian");
  });

  it("treats a MISSING principal as guardian, not as no-session", () => {
    // This is the upgrade path: a parent already signed in before the student
    // principal existed has a token in the keychain with no principal beside
    // it. Returning null here would leave the router with a live session and
    // nowhere to send it — the parent would be stuck on a blank screen with
    // no way back other than reinstalling.
    expect(readStoredPrincipal(null)).toBe("guardian");
    expect(readStoredPrincipal(undefined)).toBe("guardian");
  });

  it("treats an unrecognised or corrupted value as guardian", () => {
    for (const raw of ["", " ", "STUDENT", "Student", "teacher", "{}", "null"]) {
      expect(readStoredPrincipal(raw)).toBe("guardian");
    }
  });

  it("does not accept a case-variant of student", () => {
    // Case folding here would be a silent widening: the value is written by
    // this app, always lowercase, so anything else is corruption rather than
    // a user typing. Failing closed to the narrower surface is correct.
    expect(readStoredPrincipal("Student")).not.toBe("student");
  });
});
