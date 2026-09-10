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
