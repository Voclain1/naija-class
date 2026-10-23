import { describe, expect, it } from "vitest";

import { isSchoolAddressOrigin, schoolCodeFromOrigin } from "./school-origin.js";

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

describe("schoolCodeFromOrigin", () => {
  it("reads the code from a school's own address only", () => {
    expect(schoolCodeFromOrigin("https://virgo.schoolkit.ng", "schoolkit.ng")).toBe("virgo");
    expect(schoolCodeFromOrigin("http://virgo.localhost:3002", "localhost:3002")).toBe("virgo");
    expect(schoolCodeFromOrigin("https://app.example.com", "schoolkit.ng")).toBeNull();
    for (const ours of ["app", "portal", "cbt", "api"]) {
      expect(schoolCodeFromOrigin(`https://${ours}.schoolkit.ng`, "schoolkit.ng"), ours).toBeNull();
    }
    expect(schoolCodeFromOrigin("https://virgo.schoolkit.ng", undefined)).toBeNull();
    expect(schoolCodeFromOrigin(undefined, "schoolkit.ng")).toBeNull();
  });
});
