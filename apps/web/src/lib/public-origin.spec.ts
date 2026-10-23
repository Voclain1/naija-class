import { describe, expect, it } from "vitest";

import { publicOrigin } from "./public-origin";

describe("publicOrigin", () => {
  const own = "https://app.schoolkit.ng";
  const h = (v?: string) => new Headers(v ? { "x-schoolkit-host": v } : {});

  it("redirects on the school's own address when the portal forwarded the request", () => {
    expect(publicOrigin(h("virgo.schoolkit.ng"), own, "schoolkit.ng")).toBe("https://virgo.schoolkit.ng");
    expect(publicOrigin(h("virgo.localhost:3002"), "http://localhost:3001", "localhost:3002")).toBe("http://virgo.localhost:3002");
  });

  it("never believes a header that is not a school address", () => {
    for (const bad of ["evil.example", "portal.schoolkit.ng", "virgo.schoolkit.ng.evil.com", "a.b.schoolkit.ng"]) {
      expect(publicOrigin(h(bad), own, "schoolkit.ng"), bad).toBe(own);
    }
    expect(publicOrigin(h(), own, "schoolkit.ng")).toBe(own);
    expect(publicOrigin(h("virgo.schoolkit.ng"), own, "")).toBe(own);
  });
});
