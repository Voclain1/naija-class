import type { ReceiptListResponse, ReissueReceiptResultDto } from "@school-kit/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// staff-money imports the native uploader; replaced wholesale.
vi.mock("expo-file-system/legacy", () => ({
  uploadAsync: vi.fn(),
  deleteAsync: vi.fn(),
  FileSystemUploadType: { MULTIPART: 1 },
}));

import { setTokenProvider } from "../api/client";
import { staffFetchReceiptHtml, staffListReceipts, staffReissueReceipt } from "../api/staff-money";
import { moneyAbilities, receiptFileName } from "./money";
import { staffDestinations } from "../navigation/destinations";

// Branded receipts on the phone (docs/modules/branded-receipts.md D6).

describe("who may open receipts — the role PaymentsService checks, plus the permission", () => {
  it("is owner, admin or bursar holding payment.read", () => {
    expect(moneyAbilities([{ key: "bursar" }], ["payment.read"]).viewReceipts).toBe(true);
    expect(moneyAbilities([{ key: "admin" }], ["payment.read"]).viewReceipts).toBe(true);
    expect(moneyAbilities([{ key: "owner" }], ["*"]).reissueReceipt).toBe(true);
  });

  it("is never a teacher, even one granted the permission", () => {
    expect(moneyAbilities([{ key: "teacher" }], ["payment.read", "payment.record"])).toMatchObject({
      viewReceipts: false,
      reissueReceipt: false,
    });
  });

  it("puts Receipts in the Money menu for exactly those people", () => {
    const has = (roles: { key: string }[], permissions: string[]) =>
      staffDestinations({ roles, permissions, formArms: [], teachesSubjects: false, webConfigured: true } as never).some(
        (d) => d.key === "receipts",
      );
    expect(has([{ key: "bursar" }], ["payment.read"])).toBe(true);
    expect(has([{ key: "teacher" }], ["payment.read"])).toBe(false);
    expect(has([{ key: "admin" }], [])).toBe(false);
  });
});

describe("receiptFileName", () => {
  it("makes a receipt number safe as a file name", () => {
    expect(receiptFileName("RCP/2026/000123")).toBe("Receipt RCP-2026-000123");
    expect(receiptFileName("RCP-4F2A9C1B")).toBe("Receipt RCP-4F2A9C1B");
    expect(receiptFileName(null)).toBe("Receipt");
  });
});

describe("receipt bindings", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setTokenProvider(() => "test-token");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTokenProvider(() => null);
  });

  it("lists receipts with search and page", async () => {
    const list: ReceiptListResponse = { data: [], page: 2, hasMore: false };
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(list), { status: 200 })));
    await staffListReceipts({ search: "Okafor", page: 2 });
    const url = new URL((fetchMock.mock.calls.at(-1) as [string])[0]);
    expect(url.pathname).toMatch(/\/payments\/receipts$/);
    expect(url.searchParams.get("search")).toBe("Okafor");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("re-issues with a POST to the payment's receipt", async () => {
    const result: ReissueReceiptResultDto = { paymentId: "p1", receiptNumber: "RCP/2026/000001" };
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(result), { status: 200 })));
    await staffReissueReceipt("p1");
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toMatch(/\/payments\/p1\/receipt\/reissue$/);
    expect(init.method).toBe("POST");
  });

  it("fetches the receipt from the signed URL WITHOUT the bearer token", async () => {
    fetchMock
      .mockImplementationOnce(() =>
        Promise.resolve(new Response(JSON.stringify({ url: "https://storage.example/r.html?sig=x", expiresAt: "x" }), { status: 200 })),
      )
      .mockImplementationOnce(() => Promise.resolve(new Response("<html>OFFICIAL RECEIPT</html>", { status: 200 })));
    const html = await staffFetchReceiptHtml("p1");
    expect(html).toContain("OFFICIAL RECEIPT");
    const [storageUrl, storageInit] = fetchMock.mock.calls[1] as [string, RequestInit | undefined];
    expect(storageUrl).toBe("https://storage.example/r.html?sig=x");
    expect(JSON.stringify(storageInit ?? {})).not.toContain("test-token");
  });

  it("refuses anything that is not a receipt, or an expired link", async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ url: "https://s/r", expiresAt: "x" }), { status: 200 })))
      .mockImplementationOnce(() => Promise.resolve(new Response("<html>Access denied</html>", { status: 200 })));
    await expect(staffFetchReceiptHtml("p1")).rejects.toThrow("RECEIPT_NOT_A_RECEIPT");

    fetchMock
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ url: "https://s/r", expiresAt: "x" }), { status: 200 })))
      .mockImplementationOnce(() => Promise.resolve(new Response("expired", { status: 403 })));
    await expect(staffFetchReceiptHtml("p1")).rejects.toThrow("RECEIPT_FETCH_FAILED_403");
  });
});
