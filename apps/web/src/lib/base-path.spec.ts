import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(basePath: string) {
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", basePath);
  vi.resetModules();
  return import("./base-path");
}

describe("withBasePath / stripBasePath", () => {
  it("puts our own paths under /staff, once", async () => {
    const { withBasePath } = await load("/staff");
    expect(withBasePath("/api/auth/login")).toBe("/staff/api/auth/login");
    expect(withBasePath("/")).toBe("/staff");
    expect(withBasePath("/staff/dashboard")).toBe("/staff/dashboard");
    expect(withBasePath("https://api.schoolkit.ng/x")).toBe("https://api.schoolkit.ng/x");
    expect(withBasePath("//evil.example")).toBe("//evil.example");
  });

  it("takes /staff off a browser path for the router", async () => {
    const { stripBasePath } = await load("/staff");
    expect(stripBasePath("/staff/students/1")).toBe("/students/1");
    expect(stripBasePath("/staff")).toBe("/");
    expect(stripBasePath("/staffroom")).toBe("/staffroom");
  });

  it("does nothing without a base path", async () => {
    const { withBasePath, stripBasePath } = await load("");
    expect(withBasePath("/x")).toBe("/x");
    expect(stripBasePath("/x")).toBe("/x");
  });
});
