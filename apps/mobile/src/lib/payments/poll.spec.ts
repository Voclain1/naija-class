import { describe, expect, it, vi } from "vitest";
import type { PortalPaymentDto } from "@school-kit/types";
import { describeOutcome, pollPaymentOutcome } from "./poll";

const base: PortalPaymentDto = {
  id: "pay_1",
  invoiceId: "inv_1",
  studentId: "stu_1",
  amount: 5_000_00,
  method: "PAYSTACK",
  status: "PENDING",
  paidAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const payment = (status: PortalPaymentDto["status"]): PortalPaymentDto => ({
  ...base,
  status,
});

/** Injected so the tests do not actually wait 20 seconds. */
const noSleep = () => Promise.resolve();

describe("pollPaymentOutcome", () => {
  it("returns immediately once the payment is SUCCESS", async () => {
    const verify = vi.fn().mockResolvedValue(payment("SUCCESS"));

    const result = await pollPaymentOutcome("PSK-1", verify, { sleep: noSleep });

    expect(result.kind).toBe("succeeded");
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("keeps polling while PENDING and settles when the webhook lands", async () => {
    // The realistic case: the user closes the browser before Paystack's
    // webhook has reached the API.
    const verify = vi
      .fn()
      .mockResolvedValueOnce(payment("PENDING"))
      .mockResolvedValueOnce(payment("PENDING"))
      .mockResolvedValueOnce(payment("SUCCESS"));

    const result = await pollPaymentOutcome("PSK-1", verify, { sleep: noSleep });

    expect(result.kind).toBe("succeeded");
    expect(verify).toHaveBeenCalledTimes(3);
  });

  it("reports FAILED as failed", async () => {
    const verify = vi.fn().mockResolvedValue(payment("FAILED"));
    const result = await pollPaymentOutcome("PSK-1", verify, { sleep: noSleep });
    expect(result.kind).toBe("failed");
  });

  it("reports still-PENDING as 'pending', never as failure", async () => {
    // This distinction is the whole point. The money may already have left
    // the parent's account with the webhook still in flight; telling them it
    // FAILED invites a second payment for the same invoice.
    const verify = vi.fn().mockResolvedValue(payment("PENDING"));

    const result = await pollPaymentOutcome("PSK-1", verify, {
      attempts: 3,
      sleep: noSleep,
    });

    expect(result.kind).toBe("pending");
    expect(verify).toHaveBeenCalledTimes(3);
  });

  it("distinguishes 'never reached the server' from 'server said pending'", async () => {
    const verify = vi.fn().mockRejectedValue(new Error("offline"));

    const result = await pollPaymentOutcome("PSK-1", verify, {
      attempts: 3,
      sleep: noSleep,
    });

    // "unknown" drives different copy from "pending": we could not check at
    // all, versus we checked and it is not confirmed yet.
    expect(result.kind).toBe("unknown");
  });

  it("recovers when an early request errors but a later one answers", async () => {
    // A dropped first request must not be mistaken for a failed payment.
    const verify = vi
      .fn()
      .mockRejectedValueOnce(new Error("flaky"))
      .mockResolvedValueOnce(payment("SUCCESS"));

    const result = await pollPaymentOutcome("PSK-1", verify, { sleep: noSleep });

    expect(result.kind).toBe("succeeded");
  });

  it("waits between attempts but not before the first", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const verify = vi.fn().mockResolvedValue(payment("PENDING"));

    await pollPaymentOutcome("PSK-1", verify, { attempts: 3, sleep });

    // 3 attempts => 2 waits. Sleeping before the first would add latency to
    // the common case where the webhook has already landed.
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe("describeOutcome", () => {
  it("never tells a user a pending payment failed", () => {
    const { title, tone } = describeOutcome({ kind: "pending" });
    expect(tone).toBe("warning");
    expect(title.toLowerCase()).not.toContain("failed");
    // The anti-double-payment instruction is the load-bearing part of this
    // copy, so it is asserted rather than left to a reviewer to notice.
    expect(title.toLowerCase()).toContain("do not pay again");
  });

  it("is unambiguous about a real failure", () => {
    expect(describeOutcome({ kind: "failed", payment: payment("FAILED") }).tone).toBe(
      "danger",
    );
  });

  it("adds the known child, term and amount after a confirmed guardian payment", () => {
    expect(
      describeOutcome(
        { kind: "succeeded", payment: payment("SUCCESS") },
        { studentName: "Chidinma Adeleke", termName: "First Term" },
      ).title,
    ).toContain("₦5,000.00 was received for Chidinma Adeleke's First Term invoice.");
  });
});
