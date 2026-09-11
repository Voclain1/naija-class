import { describe, expect, it } from "vitest";

import { buildDebtorReminderMessage, buildNoRecipientWhatsAppUrl } from "@school-kit/types";

// The per-row WhatsApp share message.
//
// Specced from apps/web rather than packages/types because that package has no
// test runner at all — its "test" script is a placeholder echo. Setting one up
// is a reasonable thing to do, but not mid-way through a UI restyle; apps/web
// has a working runner and is where this builder is consumed.

describe("buildDebtorReminderMessage", () => {
  const base = {
    schoolName: "Demo Academy",
    studentName: "Chidi Okoro",
    balance: 4_500_000, // kobo
    termName: "Second Term",
    dueDate: "2026-03-01",
  };

  it("formats kobo as naira via the shared formatter, not raw kobo", () => {
    const msg = buildDebtorReminderMessage(base);
    expect(msg).toContain("₦45,000.00");
    // The raw integer must never reach a parent's phone.
    expect(msg).not.toContain("4500000");
  });

  it("names the school, the student and the term", () => {
    const msg = buildDebtorReminderMessage(base);
    expect(msg).toContain("Demo Academy");
    expect(msg).toContain("Chidi Okoro");
    expect(msg).toContain("Second Term");
  });

  it("includes the due date when there is one", () => {
    expect(buildDebtorReminderMessage(base)).toContain("due on 2026-03-01");
  });

  it("omits the due-date sentence entirely when there is none", () => {
    // dueDate is nullable on DebtorDto. "It was due on null" would be worse
    // than saying nothing.
    const msg = buildDebtorReminderMessage({ ...base, dueDate: null });
    expect(msg).not.toContain("due on");
    expect(msg).not.toContain("null");
    expect(msg).toContain("₦45,000.00");
  });

  it("handles a kobo remainder without dropping the pesewas", () => {
    const msg = buildDebtorReminderMessage({ ...base, balance: 4_500_050 });
    expect(msg).toContain("₦45,000.50");
  });

  it("produces a recipient-less wa.me url with the message encoded", () => {
    // No recipient is the whole reason this is per-row and not bulk: the
    // sender picks the conversation, so it cannot be looped over a list.
    const url = buildNoRecipientWhatsAppUrl(buildDebtorReminderMessage(base));
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(url).not.toContain("+234");
    expect(decodeURIComponent(url.split("text=")[1]!)).toContain("Chidi Okoro");
  });
});

// ── Payment options (added 2026-09-11) ──────────────────────────────────────
//
// The message offers only what the school actually supports. A line promising
// a payment link that does not exist, or a transfer account never filled in,
// is worse than a shorter message: the parent cannot act on it and has to ring
// the school anyway, which is the outcome this message exists to avoid.

const BANK = {
  bankName: "Zenith Bank",
  bankAccountName: "Demo Academy",
  bankAccountNumber: "1234567890",
};

describe("buildDebtorReminderMessage — payment options", () => {
  const base = {
    schoolName: "Demo Academy",
    studentName: "Chidi Okoro",
    balance: 4_500_000,
    termName: "Second Term",
    dueDate: null,
  };

  it("falls back to 'contact the school' when the school supports nothing yet", () => {
    const msg = buildDebtorReminderMessage(base);
    expect(msg).toContain("contact the school");
    expect(msg).not.toContain("http");
    expect(msg).not.toContain("transfer to");
  });

  it("includes the portal link when there is one", () => {
    const msg = buildDebtorReminderMessage({ ...base, portalUrl: "https://portal.schoolkit.ng" });
    expect(msg).toContain("https://portal.schoolkit.ng");
    expect(msg).not.toContain("contact the school");
  });

  it("includes the Paystack link when one is LIVE", () => {
    const msg = buildDebtorReminderMessage({ ...base, paymentLinkUrl: "https://pay.example/abc" });
    expect(msg).toContain("Pay online: https://pay.example/abc");
  });

  it("includes transfer details, with the account number intact", () => {
    const msg = buildDebtorReminderMessage({ ...base, bankDetails: BANK });
    expect(msg).toContain("Demo Academy");
    expect(msg).toContain("1234567890");
    expect(msg).toContain("Zenith Bank");
  });

  it("offers all three together when the school supports all three", () => {
    const msg = buildDebtorReminderMessage({
      ...base,
      portalUrl: "https://portal.schoolkit.ng",
      paymentLinkUrl: "https://pay.example/abc",
      bankDetails: BANK,
    });
    expect(msg).toContain("Pay online:");
    expect(msg).toContain("parent portal");
    expect(msg).toContain("transfer to");
    expect(msg).not.toContain("contact the school");
  });

  it("never renders undefined or null when an option is absent", () => {
    // The failure this guards is a parent receiving "transfer to undefined".
    for (const extra of [
      { portalUrl: null, paymentLinkUrl: null, bankDetails: null },
      { portalUrl: undefined },
      { bankDetails: null, portalUrl: "https://portal.schoolkit.ng" },
    ]) {
      const msg = buildDebtorReminderMessage({ ...base, ...extra });
      expect(msg).not.toContain("undefined");
      expect(msg).not.toContain("null");
    }
  });
});
