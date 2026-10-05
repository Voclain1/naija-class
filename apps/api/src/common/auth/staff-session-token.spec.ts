import { describe, expect, it } from "vitest";

import { readCookie, staffSessionToken } from "./staff-session-token";

const WEB = "https://app.schoolkit.ng";

function req(headers: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { header: (name: string) => lower[name.toLowerCase()] } as Parameters<typeof staffSessionToken>[0];
}

describe("staffSessionToken", () => {
  it("prefers the bearer header and never falls through from a malformed one", () => {
    expect(staffSessionToken(req({ authorization: "Bearer abc" }), WEB)).toEqual({ kind: "token", token: "abc", via: "bearer" });
    for (const bad of ["bearer abc", "Bearer ", "Token abc", ""]) {
      expect(
        staffSessionToken(req({ authorization: bad, origin: WEB, cookie: "sk_session=xyz" }), WEB),
        JSON.stringify(bad),
      ).toEqual({ kind: "missing" });
    }
  });

  it("reads the cookie only with the web app's exact Origin", () => {
    expect(staffSessionToken(req({ origin: WEB, cookie: "a=1; sk_session=xyz" }), WEB)).toEqual({ kind: "token", token: "xyz", via: "cookie" });
    for (const origin of ["https://portal.schoolkit.ng", "https://cbt.schoolkit.ng", "https://schoolkit.ng", "http://app.schoolkit.ng", "null"]) {
      expect(staffSessionToken(req({ origin, cookie: "sk_session=xyz" }), WEB), origin).toEqual({ kind: "missing" });
    }
    expect(staffSessionToken(req({ cookie: "sk_session=xyz" }), WEB)).toEqual({ kind: "missing" });
    expect(staffSessionToken(req({ origin: WEB, cookie: "sk_session=xyz" }), undefined)).toEqual({ kind: "missing" });
  });

  it("is missing when there is no cookie of that name", () => {
    expect(staffSessionToken(req({ origin: WEB, cookie: "sk_portal_session=xyz" }), WEB)).toEqual({ kind: "missing" });
    expect(staffSessionToken(req({ origin: WEB }), WEB)).toEqual({ kind: "missing" });
  });
});

describe("readCookie", () => {
  it("matches the exact name, decodes, and tolerates junk", () => {
    expect(readCookie("x_sk_session=no; sk_session=a%20b", "sk_session")).toBe("a b");
    expect(readCookie("sk_session=", "sk_session")).toBeNull();
    expect(readCookie("garbage; ;=; sk_session=%E0", "sk_session")).toBeNull();
    expect(readCookie(undefined, "sk_session")).toBeNull();
  });
});
