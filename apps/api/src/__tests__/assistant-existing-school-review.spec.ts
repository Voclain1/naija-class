import { describe, expect, it } from "vitest";
import { platformAdminSetAiClassificationSchema } from "@school-kit/types";

describe("existing school fictional review input", () => {
  const base = { classification: "FICTIONAL" as const };
  const review = { confirmFictionalOnly: true, evidenceReference: "VIRGO-PILOT-REVIEW-001", reviewedSchoolName: "Virgo Fidelis Montessori School" };
  it("accepts a complete reviewed-school attestation", () => {
    expect(platformAdminSetAiClassificationSchema.safeParse({ ...base, existingRecordsReview: review }).success).toBe(true);
  });
  it("rejects unconfirmed, empty evidence and unknown fields", () => {
    for (const existingRecordsReview of [
      { ...review, confirmFictionalOnly: false },
      { ...review, evidenceReference: "" },
      { ...review, reviewedSchoolName: "" },
      { ...review, bypass: true },
    ]) expect(platformAdminSetAiClassificationSchema.safeParse({ ...base, existingRecordsReview }).success).toBe(false);
  });
});
