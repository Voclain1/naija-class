import { describe, expect, it } from "vitest";
import {
  readReportProfile,
  reportProfileSchema,
  reportCardDesignSchema,
  planFeatureAvailable,
} from "@school-kit/types";

describe("complete report card contract", () => {
  it("leaves missing observations unknown instead of inventing a rating", () => {
    expect(readReportProfile(null).affective).toEqual({});
    expect(readReportProfile(null).nextTermDate).toBeNull();
    expect(
      reportProfileSchema.parse({ affective: { Honesty: null } }).affective
        .Honesty,
    ).toBeNull();
  });
  it("accepts only known traits and integer ratings from 1 to 5", () => {
    for (const rating of [0, 6, 1.5, "5"])
      expect(
        reportProfileSchema.safeParse({ affective: { Honesty: rating } })
          .success,
      ).toBe(false);
    expect(
      reportProfileSchema.safeParse({ affective: { Popularity: 5 } }).success,
    ).toBe(false);
    expect(
      reportProfileSchema.safeParse({ psychomotor: { Handwriting: 4 } })
        .success,
    ).toBe(true);
  });
  it("rejects impossible calendar dates and preserves a leap day", () => {
    for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "tomorrow"])
      expect(
        reportProfileSchema.safeParse({ nextTermDate: date }).success,
      ).toBe(false);
    expect(
      reportProfileSchema.parse({ nextTermDate: "2028-02-29" }).nextTermDate,
    ).toBe("2028-02-29");
  });
  it("bounds custom fields and rejects duplicate keys or arbitrary CSS", () => {
    expect(
      reportCardDesignSchema.safeParse({ color: "red; } body {display:none}" })
        .success,
    ).toBe(false);
    expect(
      reportCardDesignSchema.safeParse({ font: "Arial; color:red" }).success,
    ).toBe(false);
    expect(
      reportCardDesignSchema.safeParse({ template: "custom" }).success,
    ).toBe(false);
    const field = { key: "house", label: "House" };
    expect(
      reportCardDesignSchema.safeParse({ customFields: [field, field] })
        .success,
    ).toBe(false);
    expect(
      reportProfileSchema.safeParse({
        customFields: [
          { ...field, value: "Blue" },
          { ...field, value: "Red" },
        ],
      }).success,
    ).toBe(false);
    expect(
      reportCardDesignSchema.safeParse({
        customFields: Array.from({ length: 9 }, (_, i) => ({
          key: `field_${i}`,
          label: "Field",
        })),
      }).success,
    ).toBe(false);
  });
  it("includes complete standard academic results on Free under enforcement", () => {
    expect(planFeatureAvailable("FREE", "reportCardPositions", "enforce")).toBe(
      true,
    );
    expect(planFeatureAvailable("FREE", "reportCardBranding", "enforce")).toBe(
      false,
    );
    expect(
      planFeatureAvailable("STARTER", "reportCardBranding", "enforce"),
    ).toBe(true);
  });
});
