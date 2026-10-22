import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";

// School addresses (docs/modules/school-addresses.md): the middleware routes a
// school's own host to its public pages and sends everything else to the
// portal's own address.

let middleware: (req: NextRequest) => Response;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SCHOOL_ADDRESS_DOMAIN = "schoolkit.ng";
  process.env.NEXT_PUBLIC_PORTAL_URL = "https://portal.schoolkit.ng";
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

  it("sends signing in, and anything else, to the portal's own address", () => {
    const login = middleware(at("https://virgo.schoolkit.ng/login"));
    expect(login.status).toBe(307);
    expect(login.headers.get("location")).toBe("https://portal.schoolkit.ng/login?school=virgo");
    expect(middleware(at("https://virgo.schoolkit.ng/students/123")).headers.get("location")).toBe("https://portal.schoolkit.ng/students/123");
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
