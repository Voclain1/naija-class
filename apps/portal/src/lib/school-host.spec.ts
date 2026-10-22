import { describe, expect, it } from "vitest";

import { schoolAddressUrl, schoolCodeFromHost } from "./school-host";

describe("schoolCodeFromHost", () => {
  it("reads a school's code from its own address", () => {
    expect(schoolCodeFromHost("virgo-fidelis.schoolkit.ng", "schoolkit.ng")).toBe("virgo-fidelis");
    expect(schoolCodeFromHost("Virgo.SchoolKit.ng", "schoolkit.ng")).toBe("virgo");
    expect(schoolCodeFromHost("virgo.localhost:3002", "localhost:3002")).toBe("virgo");
  });

  it("is null for SchoolKit's own hosts, deeper names, other domains and an unset domain", () => {
    for (const host of ["portal.schoolkit.ng", "app.schoolkit.ng", "www.schoolkit.ng", "api.schoolkit.ng", "cbt.schoolkit.ng"]) {
      expect(schoolCodeFromHost(host, "schoolkit.ng")).toBeNull();
    }
    expect(schoolCodeFromHost("a.b.schoolkit.ng", "schoolkit.ng")).toBeNull();
    expect(schoolCodeFromHost("schoolkit.ng", "schoolkit.ng")).toBeNull();
    expect(schoolCodeFromHost("virgo.example.com", "schoolkit.ng")).toBeNull();
    expect(schoolCodeFromHost("virgo.schoolkit.ng", "")).toBeNull();
  });
});

describe("schoolAddressUrl", () => {
  it("builds the address, http only on localhost", () => {
    expect(schoolAddressUrl("virgo", "/apply", "schoolkit.ng")).toBe("https://virgo.schoolkit.ng/apply");
    expect(schoolAddressUrl("virgo", "/", "localhost:3002")).toBe("http://virgo.localhost:3002/");
    expect(schoolAddressUrl("virgo", "/", "")).toBeNull();
  });
});
