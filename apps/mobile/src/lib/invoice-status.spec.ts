import { describe, expect, it } from "vitest";
import { invoiceStatusLabel } from "@school-kit/types";

describe("invoiceStatusLabel", () => {
  it("keeps every family-facing invoice state human readable", () => {
    expect(invoiceStatusLabel).toEqual({
      DRAFT: "Draft",
      ISSUED: "Issued",
      PARTIALLY_PAID: "Partially paid",
      PAID: "Paid",
      OVERDUE: "Overdue",
      CANCELLED: "Cancelled",
      REFUNDED: "Refunded",
    });
  });
});
