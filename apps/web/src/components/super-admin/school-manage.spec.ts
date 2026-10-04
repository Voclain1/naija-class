import { describe, expect, it } from "vitest";

import { compactTokens, ownerStatusOf, parseTokenCount } from "./school-manage";

describe("ownerStatusOf", () => {
  it("an owner wins over any invitation state", () => {
    expect(
      ownerStatusOf({
        hasOwner: true,
        ownerInvitePending: true,
        ownerInviteExpiresAt: "2026-10-20T00:00:00.000Z",
      }),
    ).toEqual({ kind: "HAS_OWNER" });
  });
  it("a pending invitation carries its expiry", () => {
    expect(
      ownerStatusOf({
        hasOwner: false,
        ownerInvitePending: true,
        ownerInviteExpiresAt: "2026-10-20T00:00:00.000Z",
      }),
    ).toEqual({
      kind: "INVITE_PENDING",
      expiresAt: "2026-10-20T00:00:00.000Z",
    });
  });
  it("no owner and no open invitation (expired or cancelled) is NO_OWNER", () => {
    expect(
      ownerStatusOf({
        hasOwner: false,
        ownerInvitePending: false,
        ownerInviteExpiresAt: null,
      }),
    ).toEqual({ kind: "NO_OWNER" });
  });
});

describe("parseTokenCount", () => {
  it.each([
    ["750000", 750000],
    ["750,000", 750000],
    [" 2 000 000 ", 2000000],
    ["0", 0],
  ])("%j → %d", (text, n) => expect(parseTokenCount(text)).toBe(n));
  it.each(["", "abc", "1.5", "-5", "1e6", "9999999999999999999"])(
    "%j → null",
    (text) => expect(parseTokenCount(text)).toBeNull(),
  );
});

describe("compactTokens", () => {
  it.each([
    [2_000_000, "2M"],
    [750_000, "750k"],
    [1_500_000, "1.5M"],
    [999, "999"],
  ])("%d → %s", (n, s) => expect(compactTokens(n)).toBe(s));
});
