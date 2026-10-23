import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";

// School addresses (docs/modules/school-addresses.md): the middleware routes a
// school's own host to its public pages and, since 2026-10-23, its parents'
// pages under /parents (docs/modules/school-hosted-apps.md).

let middleware: (req: NextRequest) => Response;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SCHOOL_ADDRESS_DOMAIN = "schoolkit.ng";
  process.env.NEXT_PUBLIC_PORTAL_URL = "https://portal.schoolkit.ng";
  process.env.NEXT_PUBLIC_WEB_URL = "https://app.schoolkit.ng";
  ({ middleware } = await import("./middleware"));
});

const at = (url: string) => {
  const u = new URL(url);
  return new NextRequest(url, { headers: { host: u.host } });
};
const rewrittenTo = (res: Response) => res.headers.get("x-middleware-rewrite");

describe("a school's own address", () => {
  it("serves the front page, the admission form and the result checker", () => {
    expect(rewrittenTo(middleware(at("https://virgo.schoolkit.ng/")))).toBe("https://virgo.schoolkit.ng/school/virgo");
    expect(rewrittenTo(middleware(at("https://virgo.schoolkit.ng/apply")))).toBe("https://virgo.schoolkit.ng/apply/virgo");
    expect(rewrittenTo(middleware(at("https://virgo.schoolkit.ng/apply/track/abc")))).toBe("https://virgo.schoolkit.ng/apply/virgo/track/abc");
    expect(rewrittenTo(middleware(at("https://virgo.schoolkit.ng/results")))).toBe("https://virgo.schoolkit.ng/result-checker/virgo");
  });

  it("serves the website's news, each post and the gallery, and keeps a preview link's token", () => {
    const post = "0b6f3c1e-2a4d-4e5f-9a8b-7c6d5e4f3a2b";
    expect(rewrittenTo(middleware(at("https://virgo.schoolkit.ng/news")))).toBe("https://virgo.schoolkit.ng/school/virgo/news");
    expect(rewrittenTo(middleware(at(`https://virgo.schoolkit.ng/news/${post}`)))).toBe(`https://virgo.schoolkit.ng/school/virgo/news/${post}`);
    expect(rewrittenTo(middleware(at("https://virgo.schoolkit.ng/gallery")))).toBe("https://virgo.schoolkit.ng/school/virgo/gallery");
    expect(rewrittenTo(middleware(at("https://virgo.schoolkit.ng/?preview=abc")))).toBe("https://virgo.schoolkit.ng/school/virgo?preview=abc");
    // Anything else under /news is not a page of the school's.
    expect(middleware(at("https://virgo.schoolkit.ng/news/x/y")).status).toBe(307);
  });

  it("serves the parents' pages under /parents, asking for a session where the portal does", () => {
    expect(rewrittenTo(middleware(at("https://virgo.schoolkit.ng/parents/login")))).toBe("https://virgo.schoolkit.ng/login");
    expect(rewrittenTo(middleware(at("https://virgo.schoolkit.ng/parents/invitations/t1")))).toBe("https://virgo.schoolkit.ng/invitations/t1");
    // Signed out: to this address's own sign-in, keeping where they were going.
    const home = middleware(at("https://virgo.schoolkit.ng/parents"));
    expect(home.headers.get("location")).toBe("https://virgo.schoolkit.ng/parents/login");
    const child = middleware(at("https://virgo.schoolkit.ng/parents/students/123"));
    expect(child.headers.get("location")).toBe("https://virgo.schoolkit.ng/parents/login?next=%2Fparents%2Fstudents%2F123");
    // Signed in: the portal's page, uncached.
    const req = at("https://virgo.schoolkit.ng/parents/students/123");
    req.cookies.set("sk_portal_session", "t");
    const signedIn = middleware(req);
    expect(rewrittenTo(signedIn)).toBe("https://virgo.schoolkit.ng/students/123");
    expect(signedIn.headers.get("cache-control")).toContain("no-store");
  });

  it("sends a parents' page reached without /parents to its /parents form", () => {
    expect(middleware(at("https://virgo.schoolkit.ng/login")).headers.get("location")).toBe("https://virgo.schoolkit.ng/parents/login");
    expect(middleware(at("https://virgo.schoolkit.ng/students/123?x=1")).headers.get("location")).toBe(
      "https://virgo.schoolkit.ng/parents/students/123?x=1",
    );
  });

  it("forwards /staff to the staff app, naming this address, but never sign-up or the super-admin", () => {
    const res = middleware(at("https://virgo.schoolkit.ng/staff/students/1?tab=fees"));
    expect(rewrittenTo(res)).toBe("https://app.schoolkit.ng/staff/students/1?tab=fees");
    expect(res.headers.get("x-middleware-request-x-schoolkit-host")).toBe("virgo.schoolkit.ng");
    expect(rewrittenTo(middleware(at("https://virgo.schoolkit.ng/staff")))).toBe("https://app.schoolkit.ng/staff");
    for (const path of ["/staff/signup", "/staff/super-admin/dashboard"]) {
      expect(middleware(at(`https://virgo.schoolkit.ng${path}`)).headers.get("location"), path).toBe("https://virgo.schoolkit.ng/staff/login");
    }
  });

  it("never serves another school's public pages inside /parents", () => {
    for (const path of ["/parents/school/other", "/parents/apply/other", "/parents/result-checker/other"]) {
      expect(middleware(at(`https://virgo.schoolkit.ng${path}`)).headers.get("location"), path).toBe("https://virgo.schoolkit.ng/");
    }
  });
});

describe("the portal's own address", () => {
  it("still asks for a session on the signed-in pages, and leaves public pages alone", () => {
    const home = middleware(at("https://portal.schoolkit.ng/"));
    expect(home.headers.get("location")).toBe("https://portal.schoolkit.ng/login");
    expect(middleware(at("https://portal.schoolkit.ng/login")).headers.get("location")).toBeNull();
    expect(rewrittenTo(middleware(at("https://portal.schoolkit.ng/school/virgo")))).toBeNull();
  });
});
