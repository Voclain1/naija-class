import { describe, expect, it, vi } from "vitest";

import { LOGO_URL_TTL_SECONDS, parseLogoExt, signSchoolLogoUrl } from "./school-logo";
import type { StorageService } from "./storage.service";

// The logo every signed-in family screen shows (docs/modules/school-identity.md,
// slice 1), read through GET /portal/school and GET /student-portal/me/school.
describe("signSchoolLogoUrl", () => {
  function storage() {
    const signUrl = vi.fn(async () => "https://r2.example.test/signed");
    return { storage: { signUrl } as unknown as StorageService, signUrl };
  }

  it("signs the school's own logo key for an hour", async () => {
    const { storage: s, signUrl } = storage();
    await expect(signSchoolLogoUrl(s, "sch_1", "schools/sch_1/logo.webp")).resolves.toBe(
      "https://r2.example.test/signed",
    );
    expect(signUrl).toHaveBeenCalledWith("sch_1", { kind: "school-logo", ext: "webp" }, LOGO_URL_TTL_SECONDS);
    expect(LOGO_URL_TTL_SECONDS).toBe(60 * 60);
  });

  it("is null, without signing anything, when the school has no logo", async () => {
    const { storage: s, signUrl } = storage();
    await expect(signSchoolLogoUrl(s, "sch_1", null)).resolves.toBeNull();
    await expect(signSchoolLogoUrl(s, "sch_1", "schools/sch_1/logo.gif")).resolves.toBeNull();
    expect(signUrl).not.toHaveBeenCalled();
  });
});

describe("parseLogoExt", () => {
  it("accepts only the three upload types", () => {
    expect(parseLogoExt("schools/a/logo.png")).toBe("png");
    expect(parseLogoExt("schools/a/logo.jpg")).toBe("jpg");
    expect(parseLogoExt("https://legacy.example/logo.svg")).toBeNull();
    expect(parseLogoExt(undefined)).toBeNull();
  });
});
