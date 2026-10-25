import { describe, expect, it } from "vitest";

import { schoolPageDescription, schoolPageTitle, townFromAddress, type SchoolPublicDto } from "@school-kit/types";

import { articleJsonLd, frontPageMetadata, jsonLdScript, schoolJsonLd } from "./school-seo";
import { portalRobotsTxt, schoolRobotsTxt, sitemapIndexXml, urlsetXml } from "./sitemap-xml";

// Search details for a school's public pages (docs/modules/school-website.md, "Search").

function school(over: Partial<SchoolPublicDto> = {}, seo: Partial<SchoolPublicDto["seo"]> = {}): SchoolPublicDto {
  return {
    code: "greenfield",
    name: "Greenfield Academy",
    motto: "Knowledge and Service",
    logoUrl: "https://files.example/logo.png?sig=1",
    address: "14 Ogui Road, Enugu",
    phone: "0803 555 0142",
    email: "office@greenfield.edu.ng",
    admissionsOpen: true,
    resultChecker: false,
    website: { accent: null, cover: { photo: null, welcome: "A caring school in the heart of Enugu" }, about: null, facts: [], leaders: [], admissionsBox: null, events: [{ id: "e1", title: "Sports day", description: null, startDate: "2026-11-07", endDate: "2026-11-07" }], announcements: [], news: null, gallery: null, poweredBy: false, preview: false },
    seo: {
      urls: { home: "https://greenfield.schoolkit.ng/", news: "https://greenfield.schoolkit.ng/news", gallery: "https://greenfield.schoolkit.ng/gallery", apply: "https://greenfield.schoolkit.ng/apply", results: "https://greenfield.schoolkit.ng/results" },
      description: null,
      town: "Enugu",
      levels: ["Nursery", "Primary", "Senior secondary"],
      founded: 1998,
      updatedAt: null,
      ...seo,
    },
    ...over,
  };
}

describe("town from an address", () => {
  it("takes the last part that is not a state or the country", () => {
    expect(townFromAddress("14 Ogui Road, Enugu, Enugu State")).toBe("Enugu");
    expect(townFromAddress("Plot 5, Lekki Phase 1, Lagos, Nigeria")).toBe("Lagos");
    expect(townFromAddress("12 Aminu Kano Crescent, Wuse 2, Abuja, FCT")).toBe("Abuja");
    expect(townFromAddress(null)).toBeNull();
    expect(townFromAddress("Plot 22")).toBeNull();
  });
});

describe("titles and descriptions", () => {
  it("names the school, its town and levels, and says when admissions are open, within 65 characters", () => {
    // 66 characters with everything: the levels give way to "Admissions open".
    expect(schoolPageTitle(school())).toBe("Greenfield Academy, Enugu | Admissions open");
    expect(schoolPageTitle(school({ admissionsOpen: false }))).toBe("Greenfield Academy, Enugu | Nursery to secondary");
    expect(schoolPageTitle(school({ name: "Greenfield" }))).toBe("Greenfield, Enugu | Nursery to secondary | Admissions open");
    const long = schoolPageTitle(school({ name: "Saint Anthony's International Nursery and Primary School" }));
    expect(long.length).toBeLessThanOrEqual(65);
    expect(long.startsWith("Saint Anthony's International Nursery and Primary School")).toBe(true);
  });

  it("does not repeat a town already in the name", () => {
    expect(schoolPageTitle(school({ name: "Enugu Model School", admissionsOpen: false }, { levels: [] }))).toBe("Enugu Model School");
  });

  it("uses the school's own description when given, else composes one under 160 characters", () => {
    expect(schoolPageDescription(school({}, { description: "Our own words." }))).toBe("Our own words.");
    const composed = schoolPageDescription(school());
    expect(composed.startsWith("Greenfield Academy is a nursery, primary and senior secondary school in Enugu.")).toBe(true);
    expect(composed).toContain("Admissions are open");
    expect(composed.length).toBeLessThanOrEqual(160);
  });
});

describe("page metadata and structured data", () => {
  it("points at the canonical address, with a share picture, and keeps previews out of search", () => {
    const meta = frontPageMetadata(school(), false);
    expect(meta.alternates?.canonical).toBe("https://greenfield.schoolkit.ng/");
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(JSON.stringify(meta.openGraph)).toContain("https://greenfield.schoolkit.ng/share-image");
    expect(frontPageMetadata(school(), true).robots).toEqual({ index: false, follow: false });
  });

  it("describes the school with a stable logo link, never the signed one", () => {
    const ld = schoolJsonLd(school());
    expect(ld).toMatchObject({ "@type": "School", name: "Greenfield Academy", logo: "https://greenfield.schoolkit.ng/school-logo", foundingDate: "1998" });
    expect(JSON.stringify(ld)).not.toContain("sig=");
  });

  it("marks a news post as an article, and escapes script-closing text", () => {
    const ld = articleJsonLd(school(), { id: "p1", title: "Sports </script> day", body: "Fun.", publishedAt: "2026-10-01T09:00:00Z", photos: [] });
    expect(ld).toMatchObject({ "@type": "NewsArticle", mainEntityOfPage: "https://greenfield.schoolkit.ng/news/p1" });
    expect(jsonLdScript(ld)).not.toContain("</script>");
  });
});

describe("sitemaps and robots", () => {
  it("writes valid XML, escaping addresses", () => {
    const xml = urlsetXml([{ url: "https://x.schoolkit.ng/news?a=1&b=2", lastModified: "2026-10-01T00:00:00.000Z" }]);
    expect(xml).toContain("<loc>https://x.schoolkit.ng/news?a=1&amp;b=2</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod>");
    expect(sitemapIndexXml([{ url: "https://x.schoolkit.ng/sitemap.xml", lastModified: null }])).toContain("<sitemap><loc>https://x.schoolkit.ng/sitemap.xml</loc></sitemap>");
  });

  it("keeps parents', staff and tracking pages out of search", () => {
    const school = schoolRobotsTxt("https://x.schoolkit.ng/sitemap.xml");
    expect(school).toContain("Disallow: /parents");
    expect(school).toContain("Disallow: /staff");
    expect(school).toContain("Sitemap: https://x.schoolkit.ng/sitemap.xml");
    const portal = portalRobotsTxt("https://portal.schoolkit.ng/sitemap.xml");
    expect(portal).toContain("Allow: /school/");
    expect(portal).toContain("Disallow: /\n");
  });

  // Google's rule: the longest matching pattern wins, Allow on a tie.
  function allowed(robots: string, path: string): boolean {
    let best = { len: -1, allow: true };
    for (const line of robots.split("\n")) {
      const m = /^(Allow|Disallow): (.+)$/.exec(line);
      if (!m) continue;
      const pattern = m[2]!;
      const re = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"));
      if (!re.test(path)) continue;
      const allow = m[1] === "Allow";
      if (pattern.length > best.len || (pattern.length === best.len && allow)) best = { len: pattern.length, allow };
    }
    return best.allow;
  }

  it("lets Google fetch the sitemaps and render the public pages on the portal", () => {
    const portal = portalRobotsTxt("https://portal.schoolkit.ng/sitemap.xml");
    for (const path of ["/sitemap.xml", "/school/greenfield", "/school/greenfield/sitemap.xml", "/school/greenfield/share-image", "/apply/greenfield", "/_next/static/chunks/main.js", "/_next/image?url=x", "/brand/schoolkit-icon.png"]) {
      expect(allowed(portal, path), path).toBe(true);
    }
    for (const path of ["/", "/login", "/children", "/apply/greenfield/track", "/school/greenfield?preview=1"]) {
      expect(allowed(portal, path), path).toBe(false);
    }
    const school = schoolRobotsTxt("https://x.schoolkit.ng/sitemap.xml");
    expect(allowed(school, "/sitemap.xml")).toBe(true);
    expect(allowed(school, "/parents/login")).toBe(false);
  });
});
