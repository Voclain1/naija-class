import { afterEach, describe, expect, it } from "vitest";

import { portalBaseUrl } from "./portal-url";

// The per-caller specs (guardians invite, portal password reset, portal
// Paystack callback) prove each flow USES this helper. This pins the helper.
describe("portalBaseUrl", () => {
  const original = process.env.PORTAL_BASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.PORTAL_BASE_URL;
    else process.env.PORTAL_BASE_URL = original;
  });

  it("returns PORTAL_BASE_URL when set", () => {
    process.env.PORTAL_BASE_URL = "https://portal.schoolkit.ng";
    expect(portalBaseUrl()).toBe("https://portal.schoolkit.ng");
  });

  it("falls back to apps/portal's dev port when unset", () => {
    delete process.env.PORTAL_BASE_URL;
    expect(portalBaseUrl()).toBe("http://localhost:3002");
  });

  it("reads the env at call time, not at import time", () => {
    process.env.PORTAL_BASE_URL = "https://first.example.test";
    expect(portalBaseUrl()).toBe("https://first.example.test");
    process.env.PORTAL_BASE_URL = "https://second.example.test";
    expect(portalBaseUrl()).toBe("https://second.example.test");
  });
});
