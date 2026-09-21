import {
  createExpenseSchema,
  sendRemindersSchema,
  type ExpenseDto,
  type PaymentLinkStateDto,
  type SendRemindersResult,
} from "@school-kit/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// staff-money imports the native uploader; the bindings under test here do
// not touch it, so the native module is replaced wholesale.
vi.mock("expo-file-system/legacy", () => ({
  uploadAsync: vi.fn(),
  FileSystemUploadType: { MULTIPART: 1 },
}));

import { setTokenProvider } from "../api/client";
import {
  staffCreateExpense,
  staffCreatePaymentLink,
  staffPaymentLink,
  staffSendReminders,
} from "../api/staff-money";
import {
  MAX_NAIRA,
  koboInWords,
  moneyAbilities,
  nairaToKobo,
  numberInWords,
  paidAtFor,
  reminderBatches,
} from "./money";

describe("nairaToKobo — exact, never a float", () => {
  it("converts the ways people type amounts", () => {
    expect(nairaToKobo("50000")).toEqual({ ok: true, kobo: 5_000_000 });
    expect(nairaToKobo("50,000")).toEqual({ ok: true, kobo: 5_000_000 });
    expect(nairaToKobo("₦ 50,000.50")).toEqual({ ok: true, kobo: 5_000_050 });
    expect(nairaToKobo("50000.5")).toEqual({ ok: true, kobo: 5_000_050 });
    expect(nairaToKobo("0.01")).toEqual({ ok: true, kobo: 1 });
    expect(nairaToKobo("12.")).toEqual({ ok: true, kobo: 1_200 });
  });

  it("gets the amounts floats get wrong exactly right", () => {
    // 0.29 * 100 === 28.999999999999996 in floating point.
    expect(nairaToKobo("0.29")).toEqual({ ok: true, kobo: 29 });
    expect(nairaToKobo("1.15")).toEqual({ ok: true, kobo: 115 });
    expect(nairaToKobo("4.35")).toEqual({ ok: true, kobo: 435 });
  });

  it("REFUSES rather than rounds", () => {
    expect(nairaToKobo("50000.505")).toEqual({ ok: false, reason: "too-precise" });
    expect(nairaToKobo("")).toEqual({ ok: false, reason: "empty" });
    expect(nairaToKobo("-500")).toEqual({ ok: false, reason: "invalid" });
    expect(nairaToKobo("5e4")).toEqual({ ok: false, reason: "invalid" });
    expect(nairaToKobo("fifty")).toEqual({ ok: false, reason: "invalid" });
    expect(nairaToKobo("1.2.3")).toEqual({ ok: false, reason: "invalid" });
    expect(nairaToKobo("0")).toEqual({ ok: false, reason: "zero" });
    expect(nairaToKobo("0.00")).toEqual({ ok: false, reason: "zero" });
  });

  it("refuses absurd amounts, and every accepted amount is a safe integer", () => {
    expect(nairaToKobo(String(MAX_NAIRA + 1))).toEqual({ ok: false, reason: "too-large" });
    expect(nairaToKobo("99999999999999999999")).toEqual({ ok: false, reason: "too-large" });
    const top = nairaToKobo(String(MAX_NAIRA));
    expect(top.ok && Number.isSafeInteger(top.kobo)).toBe(true);
  });
});

describe("amounts in words", () => {
  it("reads numbers the way a Nigerian cheque does", () => {
    expect(numberInWords(0)).toBe("zero");
    expect(numberInWords(15)).toBe("fifteen");
    expect(numberInWords(105)).toBe("one hundred and five");
    expect(numberInWords(1_005)).toBe("one thousand and five");
    expect(numberInWords(50_000)).toBe("fifty thousand");
    expect(numberInWords(1_250_000)).toBe("one million, two hundred and fifty thousand");
    expect(numberInWords(2_000_021)).toBe("two million and twenty-one");
  });

  it("says naira and kobo", () => {
    expect(koboInWords(5_000_000)).toBe("fifty thousand naira");
    expect(koboInWords(5_000_050)).toBe("fifty thousand naira, fifty kobo");
    expect(koboInWords(1)).toBe("zero naira, one kobo");
  });

  it("makes a misplaced zero obvious", () => {
    expect(koboInWords(500_000_00)).not.toBe(koboInWords(50_000_00));
    expect(koboInWords(500_000_00)).toBe("five hundred thousand naira");
  });
});

describe("who may do what with money", () => {
  it("follows each endpoint's permission", () => {
    const bursar = moneyAbilities([{ key: "bursar" }], [
      "payment.read",
      "payment.record",
      "finance.debtors.remind",
      "expense.create",
      "expense-category.read",
      "expense.update",
    ]);
    expect(bursar).toEqual({ recordPayment: true, remind: true, paymentLink: true, logExpense: true, attachReceipt: true });
  });

  it("offers payment links only to owner, admin or bursar — the role PaymentLinksService checks", () => {
    expect(moneyAbilities([{ key: "teacher" }], ["*"]).paymentLink).toBe(false);
    expect(moneyAbilities([{ key: "owner" }], ["*"]).paymentLink).toBe(true);
  });

  it("offers nothing without the permission", () => {
    expect(moneyAbilities([{ key: "admin" }], [])).toEqual({
      recordPayment: false,
      remind: false,
      paymentLink: false,
      logExpense: false,
      attachReceipt: false,
    });
  });
});

describe("paidAtFor", () => {
  it("is the moment of recording for today, and midday Lagos for an earlier date", () => {
    expect(paidAtFor(null, Date.parse("2026-09-22T08:30:00.000Z"))).toBe("2026-09-22T08:30:00.000Z");
    expect(paidAtFor("2026-09-20", 0)).toBe("2026-09-20T11:00:00.000Z");
  });
});

describe("reminderBatches", () => {
  it("never exceeds the server's 50 per request", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `s${i}`);
    const batches = reminderBatches(ids);
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
    expect(batches.flat()).toEqual(ids);
  });
});

describe("money bindings", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const TERM = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
  const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

  beforeEach(() => {
    setTokenProvider(() => "test-token");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTokenProvider(() => null);
  });

  function respond(body: unknown, status = 200): void {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  }

  it("sends reminders in valid batches and totals the results", async () => {
    const perBatch: SendRemindersResult = { sent: 2, skipped: 1 };
    respond(perBatch);
    const ids = Array.from({ length: 60 }, (_, i) => uuid(i));
    const result = await staffSendReminders(TERM, ids);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      expect(url).toMatch(/\/finance\/debtors\/remind$/);
      expect(sendRemindersSchema.safeParse(JSON.parse(init.body as string)).success).toBe(true);
    }
    expect(result).toEqual({ sent: 4, skipped: 2, batchesSent: 2, batchesTotal: 2 });
  });

  it("stops at the first failed batch — a sent reminder cannot be unsent, so nothing is retried", async () => {
    let call = 0;
    fetchMock.mockImplementation(() => {
      call += 1;
      return Promise.resolve(
        call === 1
          ? new Response(JSON.stringify({ sent: 50, skipped: 0 }), { status: 200 })
          : new Response(JSON.stringify({ error: { code: "INTERNAL", message: "boom" } }), { status: 500 }),
      );
    });
    await expect(staffSendReminders(TERM, Array.from({ length: 120 }, (_, i) => uuid(i)))).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reads and creates a payment link on the invoice's route", async () => {
    const live: PaymentLinkStateDto = {
      state: "LIVE",
      id: "l1",
      url: "https://paystack.com/pay/abc",
      amount: 5_000_000,
      currency: "NGN",
      schoolName: "Test School",
      studentLabel: "Adaeze O.",
      requestCode: "PRQ_1",
      createdAt: "2026-09-22T08:00:00.000Z",
    };
    respond(live);
    await staffPaymentLink("inv-1");
    expect((fetchMock.mock.calls.at(-1) as [string, RequestInit])[0]).toMatch(/\/invoices\/inv-1\/payment-link$/);
    await staffCreatePaymentLink("inv-1");
    expect((fetchMock.mock.calls.at(-1) as [string, RequestInit])[1].method).toBe("POST");
  });

  it("creates an expense with a body the API validates, amount in kobo", async () => {
    respond({ id: "e1" } as unknown as ExpenseDto, 201);
    const parsed = nairaToKobo("15,000");
    if (!parsed.ok) throw new Error("parse");
    await staffCreateExpense({ categoryId: uuid(1), amount: parsed.kobo, incurredAt: "2026-09-22" });
    const body = JSON.parse((fetchMock.mock.calls.at(-1) as [string, RequestInit])[1].body as string);
    expect(body.amount).toBe(1_500_000);
    expect(createExpenseSchema.safeParse(body).success).toBe(true);
  });
});
