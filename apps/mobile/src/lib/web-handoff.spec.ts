import { describe, expect, it } from "vitest";

import { WEB_NOT_CONFIGURED_MESSAGE, signedInWebUrl, webOrigin, webUrl } from "./web-handoff";

// Sending someone to the website (CP4 D36), and — since 2026-09-23 — doing it
// with them already signed in.

describe("the configured website address", () => {
  it("accepts an absolute http(s) origin and trims trailing slashes", () => {
    expect(webOrigin("https://app.schoolkit.ng/")).toBe("https://app.schoolkit.ng");
    expect(webUrl("/settings", "https://app.schoolkit.ng")).toBe("https://app.schoolkit.ng/settings");
  });

  it("refuses anything that would open somewhere unexpected", () => {
    for (const raw of ["", "   ", "app.schoolkit.ng", "javascript:alert(1)", "https://a.b/path"]) {
      expect(webOrigin(raw)).toBeNull();
    }
    expect(webUrl("/settings", null)).toBeNull();
    expect(WEB_NOT_CONFIGURED_MESSAGE).toContain("website");
  });
});

// Signed-in handoff (docs/modules/web-handoff-signin.md), the app's half.
describe("signedInWebUrl", () => {
  const ORIGIN = "https://app.schoolkit.ng";

  it("opens the handoff route carrying the token and where to land", async () => {
    const url = await signedInWebUrl("/finance", async () => ({ token: "tok-123" }), ORIGIN);
    expect(url).toBe("https://app.schoolkit.ng/handoff?t=tok-123&next=%2Ffinance");
  });

  it("falls back to the plain link when minting fails — never worse than before", async () => {
    const url = await signedInWebUrl(
      "/settings",
      async () => {
        throw new Error("offline");
      },
      ORIGIN,
    );
    expect(url).toBe("https://app.schoolkit.ng/settings");
  });

  it("falls back when the server returns no token", async () => {
    const url = await signedInWebUrl("/settings", async () => ({ token: "" }), ORIGIN);
    expect(url).toBe("https://app.schoolkit.ng/settings");
  });

  it("stays null when the website address is not configured in this build", async () => {
    expect(await signedInWebUrl("/settings", async () => ({ token: "t" }), null)).toBeNull();
  });
});
