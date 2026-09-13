import { describe, expect, it } from "vitest";

import type { PaymentLinkStateDto } from "@school-kit/types";

import { resolveShareablePaymentLink, shareablePaymentLinkUrl } from "./shareable-payment-link";

const BALANCE = 4_500_000; // kobo

const live = (amount: number): PaymentLinkStateDto => ({
  state: "LIVE",
  id: "pl-1",
  url: "https://paystack.com/pay/PRQ_abc",
  amount,
  currency: "NGN",
  schoolName: "Demo Academy",
  studentLabel: "Chidi Okoro (ADM/1)",
  requestCode: "PRQ_abc",
  createdAt: "2026-09-13T00:00:00.000Z",
});

describe("shareablePaymentLinkUrl", () => {
  it("returns the URL for a LIVE link whose amount matches the quoted balance", () => {
    expect(shareablePaymentLinkUrl(live(BALANCE), BALANCE)).toBe("https://paystack.com/pay/PRQ_abc");
  });

  it("returns null for every non-LIVE state", () => {
    const states: PaymentLinkStateDto[] = [
      { state: "CONNECT_PAYSTACK" },
      { state: "NOT_CREATED" },
      { state: "CREATING" },
      { state: "RETRYABLE_FAILURE", failureCode: "PAYSTACK_DOWN" },
    ];
    for (const s of states) {
      expect(shareablePaymentLinkUrl(s, BALANCE), s.state).toBeNull();
    }
  });

  it("returns null when a LIVE link's amount disagrees with the balance (stale list)", () => {
    // A payment landed after the debtor list loaded. Quoting both figures in
    // one message would tell the parent two different amounts.
    expect(shareablePaymentLinkUrl(live(3_000_000), BALANCE)).toBeNull();
    expect(shareablePaymentLinkUrl(live(BALANCE + 1), BALANCE)).toBeNull();
  });

  it("returns null for a missing state", () => {
    expect(shareablePaymentLinkUrl(null, BALANCE)).toBeNull();
    expect(shareablePaymentLinkUrl(undefined, BALANCE)).toBeNull();
  });
});

describe("resolveShareablePaymentLink", () => {
  it("resolves a matching LIVE link to its URL", async () => {
    await expect(resolveShareablePaymentLink(async () => live(BALANCE), BALANCE)).resolves.toBe(
      "https://paystack.com/pay/PRQ_abc",
    );
  });

  it("resolves to null — never rejects — when the fetch fails (403, 404, network)", async () => {
    const failing = async (): Promise<PaymentLinkStateDto> => {
      throw new Error("403 FORBIDDEN");
    };
    await expect(resolveShareablePaymentLink(failing, BALANCE)).resolves.toBeNull();
  });

  it("resolves to null after the timeout when the fetch hangs", async () => {
    const hanging = () => new Promise<PaymentLinkStateDto>(() => undefined);
    const started = Date.now();
    await expect(resolveShareablePaymentLink(hanging, BALANCE, 50)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("a link that arrives AFTER the timeout is not used", async () => {
    const slow = () => new Promise<PaymentLinkStateDto>((r) => setTimeout(() => r(live(BALANCE)), 200));
    await expect(resolveShareablePaymentLink(slow, BALANCE, 20)).resolves.toBeNull();
  });
});
