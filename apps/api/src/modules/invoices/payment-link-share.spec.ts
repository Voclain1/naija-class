import { describe, expect, it } from "vitest";

import { buildNoRecipientWhatsAppUrl, buildPaymentLinkMessage } from "@school-kit/types";

describe("payment-link sharing contract", () => {
  it("builds a no-recipient wa.me URL with the complete encoded message", () => {
    const message = buildPaymentLinkMessage({
      schoolName: "Unity College",
      studentLabel: "Ada Okafor (SK-014)",
      amount: 210_000,
      url: "https://paystack.com/pay/PRQ_test",
    });
    const url = buildNoRecipientWhatsAppUrl(message);
    expect(url).toBe(`https://wa.me/?text=${encodeURIComponent(message)}`);
    expect(new URL(url).searchParams.get("text")).toBe(message);
    expect(new URL(url).pathname).toBe("/");
    expect(url).not.toMatch(/wa\.me\/[+0-9]/);
    expect(message).not.toMatch(/@|guardian|parent/i);
  });
});
