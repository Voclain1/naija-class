import { afterEach, describe, expect, it } from "vitest";

import { parentSiteUrl, publicSiteUrls, schoolSiteUrls, staffSiteUrl } from "./school-site-url.js";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("schoolSiteUrls", () => {
  it("keeps every link on the portal until the switch is on", () => {
    process.env.PORTAL_BASE_URL = "https://portal.schoolkit.ng";
    process.env.SCHOOL_ADDRESS_DOMAIN = "schoolkit.ng";
    delete process.env.SCHOOL_ADDRESSES_LIVE;
    const urls = schoolSiteUrls("virgo");
    expect(urls.home).toBe("https://portal.schoolkit.ng/school/virgo");
    expect(urls.apply).toBe("https://portal.schoolkit.ng/apply/virgo");
    expect(urls.results).toBe("https://portal.schoolkit.ng/result-checker/virgo");
    expect(urls.track("t1")).toBe("https://portal.schoolkit.ng/apply/virgo/track/t1");
  });

  it("uses the school's own address once it is on", () => {
    process.env.SCHOOL_ADDRESS_DOMAIN = "schoolkit.ng";
    process.env.SCHOOL_ADDRESSES_LIVE = "on";
    const urls = schoolSiteUrls("virgo");
    expect(urls.home).toBe("https://virgo.schoolkit.ng/");
    expect(urls.apply).toBe("https://virgo.schoolkit.ng/apply");
    expect(urls.results).toBe("https://virgo.schoolkit.ng/results");
    expect(urls.track("t1")).toBe("https://virgo.schoolkit.ng/apply/track/t1");
  });

  it("needs the domain as well as the switch", () => {
    process.env.PORTAL_BASE_URL = "https://portal.schoolkit.ng";
    process.env.SCHOOL_ADDRESSES_LIVE = "on";
    delete process.env.SCHOOL_ADDRESS_DOMAIN;
    expect(schoolSiteUrls("virgo").apply).toBe("https://portal.schoolkit.ng/apply/virgo");
  });
});

describe("parentSiteUrl / staffSiteUrl", () => {
  it("stay on the portal and the staff app until the switch is on", () => {
    process.env.PORTAL_BASE_URL = "https://portal.schoolkit.ng";
    process.env.WEB_BASE_URL = "https://app.schoolkit.ng/";
    process.env.SCHOOL_ADDRESS_DOMAIN = "schoolkit.ng";
    delete process.env.SCHOOL_ADDRESSES_LIVE;
    expect(parentSiteUrl("virgo", "/invitations/t")).toBe("https://portal.schoolkit.ng/invitations/t");
    expect(staffSiteUrl("virgo", "/invitations/t")).toBe("https://app.schoolkit.ng/invitations/t");
  });

  it("use the school's own address once it is on", () => {
    process.env.SCHOOL_ADDRESS_DOMAIN = "schoolkit.ng";
    process.env.SCHOOL_ADDRESSES_LIVE = "on";
    expect(parentSiteUrl("virgo", "/reset-password?token=x")).toBe("https://virgo.schoolkit.ng/parents/reset-password?token=x");
    expect(staffSiteUrl("virgo", "/admissions/a1")).toBe("https://virgo.schoolkit.ng/staff/admissions/a1");
    expect(publicSiteUrls("virgo")).toMatchObject({
      parents: "https://virgo.schoolkit.ng/parents/login",
      staff: "https://virgo.schoolkit.ng/staff/login",
    });
  });

  it("fall back when there is no school to hand", () => {
    process.env.PORTAL_BASE_URL = "https://portal.schoolkit.ng";
    process.env.WEB_BASE_URL = "https://app.schoolkit.ng";
    process.env.SCHOOL_ADDRESS_DOMAIN = "schoolkit.ng";
    process.env.SCHOOL_ADDRESSES_LIVE = "on";
    expect(parentSiteUrl(null, "/login")).toBe("https://portal.schoolkit.ng/login");
    expect(staffSiteUrl(undefined, "/login")).toBe("https://app.schoolkit.ng/login");
  });
});
