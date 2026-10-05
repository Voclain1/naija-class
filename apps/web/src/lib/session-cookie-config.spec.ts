import { describe, expect, it } from "vitest";

import { sessionCookieConfigProblem } from "../../session-cookie-config.mjs";

// The production build refuses a configuration that would sign every member
// of staff out (docs/deferred.md item 1).

const GOOD = {
  VERCEL_ENV: "production",
  SESSION_COOKIE_DOMAIN: "schoolkit.ng",
  NEXT_PUBLIC_API_URL: "https://api.schoolkit.ng/api/v1",
  VERCEL_PROJECT_PRODUCTION_URL: "app.schoolkit.ng",
};

describe("sessionCookieConfigProblem", () => {
  it("accepts the production configuration", () => {
    expect(sessionCookieConfigProblem(GOOD)).toBeNull();
    expect(sessionCookieConfigProblem({ ...GOOD, SESSION_COOKIE_DOMAIN: ".schoolkit.ng" })).toBeNull();
  });

  it("checks nothing outside a Vercel production build", () => {
    expect(sessionCookieConfigProblem({})).toBeNull();
    expect(sessionCookieConfigProblem({ VERCEL_ENV: "preview" })).toBeNull();
  });

  it("refuses a missing domain", () => {
    expect(sessionCookieConfigProblem({ ...GOOD, SESSION_COOKIE_DOMAIN: undefined })).toMatch(/SESSION_COOKIE_DOMAIN/);
  });

  it("refuses the API's old fly.dev address, which would never receive the cookie", () => {
    expect(
      sessionCookieConfigProblem({ ...GOOD, NEXT_PUBLIC_API_URL: "https://school-kit-api.fly.dev/api/v1" }),
    ).toMatch(/under schoolkit\.ng/);
  });

  it("refuses plain http, an unparseable URL, and a look-alike host", () => {
    expect(sessionCookieConfigProblem({ ...GOOD, NEXT_PUBLIC_API_URL: "http://api.schoolkit.ng/api/v1" })).not.toBeNull();
    expect(sessionCookieConfigProblem({ ...GOOD, NEXT_PUBLIC_API_URL: "not a url" })).not.toBeNull();
    expect(sessionCookieConfigProblem({ ...GOOD, NEXT_PUBLIC_API_URL: "https://api.evilschoolkit.ng/api/v1" })).not.toBeNull();
  });

  it("refuses a web address outside the cookie's domain", () => {
    expect(sessionCookieConfigProblem({ ...GOOD, VERCEL_PROJECT_PRODUCTION_URL: "school-kit-web.vercel.app" })).toMatch(
      /not under/,
    );
  });
});
