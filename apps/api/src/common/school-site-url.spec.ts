import { afterEach, describe, expect, it } from "vitest";

import { schoolSiteUrls } from "./school-site-url.js";

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
