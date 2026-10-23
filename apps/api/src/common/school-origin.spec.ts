import { describe, expect, it } from "vitest";

import { isSchoolAddressOrigin } from "./school-origin.js";

describe("isSchoolAddressOrigin", () => {
  it("allows a school's own address, over https, one label deep", () => {
    expect(isSchoolAddressOrigin("https://virgo-fidelis.schoolkit.ng", "schoolkit.ng")).toBe(true);
    expect(isSchoolAddressOrigin("http://virgo-fidelis.schoolkit.ng", "schoolkit.ng")).toBe(false);
    expect(isSchoolAddressOrigin("https://a.b.schoolkit.ng", "schoolkit.ng")).toBe(false);
    expect(isSchoolAddressOrigin("https://schoolkit.ng", "schoolkit.ng")).toBe(false);
  });

  it("refuses look-alikes and anything when the domain is unset", () => {
    expect(isSchoolAddressOrigin("https://virgo.schoolkit.ng.evil.com", "schoolkit.ng")).toBe(false);
    expect(isSchoolAddressOrigin("https://virgo.schoolkitXng", "schoolkit.ng")).toBe(false);
    expect(isSchoolAddressOrigin("https://evilschoolkit.ng", "schoolkit.ng")).toBe(false);
    expect(isSchoolAddressOrigin("https://virgo.schoolkit.ng", undefined)).toBe(false);
    expect(isSchoolAddressOrigin(undefined, "schoolkit.ng")).toBe(false);
  });

  it("allows plain http on a localhost domain, for development", () => {
    expect(isSchoolAddressOrigin("http://virgo.localhost:3002", "localhost:3002")).toBe(true);
    expect(isSchoolAddressOrigin("http://virgo.localhost:3009", "localhost:3002")).toBe(false);
  });
});
