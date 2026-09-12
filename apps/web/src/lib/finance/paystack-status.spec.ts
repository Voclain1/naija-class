import { describe, expect, it } from "vitest";

import { resolvePaystackStatus } from "./paystack-status";

// The finance dashboard's eyebrow status line.
//
// The assertion that matters most is the LAST one: this line replaced a
// mockup that displayed a bank account number, and nothing here may ever
// carry account-shaped data onto a page that renders on every finance visit.

const LIVE = { paystackSubaccountCode: "ACCT_abc123", paystackPaymentsEnabled: true };

describe("resolvePaystackStatus", () => {
  it("reports live when a subaccount exists and payments are enabled", () => {
    expect(resolvePaystackStatus(LIVE)).toEqual({ state: "LIVE", label: "Card payments live" });
  });

  it("distinguishes 'connected but off' from 'never set up'", () => {
    // These two must not collapse into one message. The first is a toggle
    // away from working; the second needs the whole Paystack onboarding, and
    // sending a school down the wrong path costs it real collection time.
    expect(resolvePaystackStatus({ ...LIVE, paystackPaymentsEnabled: false }).state).toBe(
      "CONFIGURED_OFF",
    );
    expect(resolvePaystackStatus({ paystackSubaccountCode: null, paystackPaymentsEnabled: false }).state).toBe(
      "NOT_CONNECTED",
    );
  });

  it("treats enabled-with-no-subaccount as not connected, not live", () => {
    // The API forbids this combination, but if it ever leaked through, saying
    // "live" would tell a school it can take card payments when it cannot.
    expect(
      resolvePaystackStatus({ paystackSubaccountCode: null, paystackPaymentsEnabled: true }).state,
    ).toBe("NOT_CONNECTED");
  });

  it("treats a blank-string subaccount code as absent", () => {
    expect(
      resolvePaystackStatus({ paystackSubaccountCode: "   ", paystackPaymentsEnabled: true }).state,
    ).toBe("NOT_CONNECTED");
  });

  it("returns not-connected for a missing school rather than throwing", () => {
    // useAuth().school is null before the session resolves.
    expect(resolvePaystackStatus(null).state).toBe("NOT_CONNECTED");
    expect(resolvePaystackStatus(undefined).state).toBe("NOT_CONNECTED");
  });

  it("never surfaces the subaccount code or any account-shaped string", () => {
    // THE point of this helper. The mockup put "#3021949182 (Wema Bank)" in
    // this slot; the label must carry no identifier at all, only a status.
    for (const input of [
      LIVE,
      { ...LIVE, paystackPaymentsEnabled: false },
      { paystackSubaccountCode: null, paystackPaymentsEnabled: false },
    ]) {
      const { label } = resolvePaystackStatus(input);
      expect(label).not.toContain("ACCT");
      expect(label).not.toMatch(/\d/);
    }
  });

  it("does not say 'bursar' — not every school has one", () => {
    expect(resolvePaystackStatus(LIVE).label.toLowerCase()).not.toContain("bursar");
  });
});
