import { describe, expect, it } from "vitest";

import { withPrefix } from "./portal-path";

describe("withPrefix", () => {
  it("puts the parents' pages under /parents at a school's address", () => {
    expect(withPrefix("/parents", "/")).toBe("/parents");
    expect(withPrefix("/parents", "/students/1")).toBe("/parents/students/1");
    expect(withPrefix("/parents", "/login?reason=expired")).toBe("/parents/login?reason=expired");
    expect(withPrefix("/parents", "/?x=1")).toBe("/parents?x=1");
  });

  it("leaves a prefixed, external or protocol-relative link alone, and everything off a school's address", () => {
    expect(withPrefix("/parents", "/parents/students/1")).toBe("/parents/students/1");
    expect(withPrefix("/parents", "https://paystack.com/x")).toBe("https://paystack.com/x");
    expect(withPrefix("/parents", "//evil.example")).toBe("//evil.example");
    expect(withPrefix("", "/students/1")).toBe("/students/1");
  });
});
