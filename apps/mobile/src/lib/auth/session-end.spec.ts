import { describe, expect, it } from "vitest";
import { sessionEndMessage, sessionEndNoticeForPrincipal } from "./session-end";

describe("session-end copy and isolation", () => {
  it("uses reviewed copy without raw backend codes", () => {
    expect(sessionEndMessage("SESSION_EXPIRED")).toBe("Your session expired. Sign in again to continue.");
    expect(sessionEndMessage("INVALID_SESSION")).toBe("Your session ended. Sign in again.");
    expect(sessionEndMessage("USER_INACTIVE")).toBe(
      "Your account is no longer active. Contact your school administrator.",
    );
  });

  it("shows a reason only to the principal whose session ended", () => {
    const notice = { principal: "guardian" as const, reason: "INVALID_SESSION" as const, message: "Your session ended. Sign in again." };
    expect(sessionEndNoticeForPrincipal(notice, "guardian")).toEqual(notice);
    expect(sessionEndNoticeForPrincipal(notice, "student")).toBeNull();
    expect(sessionEndNoticeForPrincipal(notice, "staff")).toBeNull();
  });
});
