import { describe, expect, it } from "vitest";

import {
  canRequestToken,
  needsRegistration,
  shouldRequestPermission,
} from "./push-eligibility";

describe("shouldRequestPermission", () => {
  it("asks when the user has never been asked (iOS shape)", () => {
    expect(shouldRequestPermission({ status: "undetermined", canAskAgain: true })).toBe(true);
  });

  it("asks on a fresh Android 13+ install, which reports DENIED before ever asking", () => {
    // The regression this function shipped with, found on Android 16: the old
    // test was `status === "undetermined"`, and expo-notifications' Android
    // implementation resolves DENIED whenever areNotificationsEnabled() is
    // false — true on every fresh install. No Android 13+ device was ever
    // prompted, so push was silently off for all of them.
    expect(shouldRequestPermission({ status: "denied", canAskAgain: true })).toBe(true);
  });

  it("does NOT re-ask after a real denial", () => {
    // The original intent, now expressed by the field that actually means it.
    // A second request after a refusal shows no prompt and returns denied, so
    // re-asking cannot change the answer — Settings is the only route, and
    // that is the OS's decision.
    expect(shouldRequestPermission({ status: "denied", canAskAgain: false })).toBe(false);
  });

  it("does not ask again once granted, whatever canAskAgain says", () => {
    expect(shouldRequestPermission({ status: "granted", canAskAgain: true })).toBe(false);
    expect(shouldRequestPermission({ status: "granted", canAskAgain: false })).toBe(false);
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
