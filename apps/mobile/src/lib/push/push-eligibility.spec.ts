import { describe, expect, it } from "vitest";

import {
  canRequestToken,
  needsRegistration,
  shouldRequestPermission,
} from "./push-eligibility";

describe("shouldRequestPermission", () => {
  it("asks when the user has never been asked", () => {
    expect(shouldRequestPermission("undetermined")).toBe(true);
  });

  it("does NOT re-ask after a denial", () => {
    // The important one. On both platforms a second request after "denied"
    // returns denied without showing a prompt, so re-asking cannot change
    // the answer — it just costs a native round trip on every launch.
    expect(shouldRequestPermission("denied")).toBe(false);
  });

  it("does not ask again once granted", () => {
    expect(shouldRequestPermission("granted")).toBe(false);
  });
});

describe("canRequestToken", () => {
  it("allows a granted permission on a real device", () => {
    expect(canRequestToken({ permission: "granted", isDevice: true })).toBe(true);
  });

  it("refuses without permission, even on a real device", () => {
    expect(canRequestToken({ permission: "denied", isDevice: true })).toBe(false);
    expect(canRequestToken({ permission: "undetermined", isDevice: true })).toBe(false);
  });

  it("refuses on a simulator, even with permission granted", () => {
    // Attempting a token here produces a confusing native error rather than
    // a clean "unsupported", which is exactly the kind of thing that gets
    // mistaken for a real bug during verification.
    expect(canRequestToken({ permission: "granted", isDevice: false })).toBe(false);
  });
});

describe("needsRegistration", () => {
  const base = {
    token: "ExponentPushToken[a]",
    principal: "guardian",
    lastRegisteredToken: "ExponentPushToken[a]",
    lastRegisteredPrincipal: "guardian",
  };

  it("skips when nothing has changed", () => {
    // Expo returns the same token every launch, so without this the app
    // would POST once per open, per user, forever.
    expect(needsRegistration(base)).toBe(false);
  });

  it("registers on first ever launch", () => {
    expect(
      needsRegistration({ ...base, lastRegisteredToken: null, lastRegisteredPrincipal: null }),
    ).toBe(true);
  });

  it("registers when the token itself changed", () => {
    expect(needsRegistration({ ...base, token: "ExponentPushToken[b]" })).toBe(true);
  });

  it("registers when the SAME token changes principal", () => {
    // The shared-family-handset case, and the reason principal is part of
    // the comparison at all: a parent signs out, their child signs in on the
    // same phone, and the server must reassign the row — otherwise the
    // child's notifications keep going to the parent's account.
    expect(needsRegistration({ ...base, principal: "student" })).toBe(true);
  });
});
