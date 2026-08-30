import { describe, expect, it } from "vitest";

import {
  invoiceStatusLabel,
  paymentStatusLabel,
  payrollStatusLabel,
} from "@school-kit/types";

describe("shared finance status labels", () => {
  it("turns API status values into school-facing labels", () => {
    expect(invoiceStatusLabel.PARTIALLY_PAID).toBe("Partially paid");
    expect(paymentStatusLabel.SUCCESS).toBe("Successful");
    expect(payrollStatusLabel.APPROVED).toBe("Approved");
  });
});
