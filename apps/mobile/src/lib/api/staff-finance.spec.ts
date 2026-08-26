import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setTokenProvider } from "./client";
import {
  staffAcademicYears,
  staffDebtors,
  staffFinanceDashboard,
  staffTermsOfYear,
} from "./staff-finance";
import { resetServerClock } from "../staff/server-date";
import { hasPermission } from "../auth/permissions";

// Wire-contract regressions for CP3's four bindings, plus the read-only
// property asserted as a property rather than described in a comment.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", date: "Tue, 25 Aug 2026 09:30:00 GMT" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetServerClock();
  setTokenProvider(() => "test-token");
  // mockImplementation, not mockResolvedValue: a Response body can only be
  // read once, so each call needs its own Response object.
  fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse([])));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setTokenProvider(() => null);
  resetServerClock();
});

function calls(): Array<{ url: string; init: RequestInit }> {
  return fetchMock.mock.calls.map(([url, init]) => ({ url, init } as { url: string; init: RequestInit }));
}

describe("staff finance bindings", () => {
  it("reads the academic years list", async () => {
    await staffAcademicYears();
    expect(calls().at(-1)?.url).toContain("/academic-years");
  });

  it("encodes the year id into the terms path", async () => {
    await staffTermsOfYear("year/with space");
    expect(calls().at(-1)?.url).toContain("/academic-years/year%2Fwith%20space/terms");
  });

  it("passes termId as a query parameter to both finance endpoints", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({})));
    await staffFinanceDashboard("term-1");
    expect(calls().at(-1)?.url).toContain("/finance/dashboard?termId=term-1");

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse([])));
    await staffDebtors("term-1");
    expect(calls().at(-1)?.url).toContain("/finance/debtors?termId=term-1");
  });

  it("is READ-ONLY: every CP3 call is a GET with no body", async () => {
    // The checkpoint's defining property, asserted rather than promised. A
    // future write added to this module fails here, which is the point — the
    // plan-first keeps payment recording, refunds and reminders on web.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({})));
    await staffAcademicYears();
    await staffTermsOfYear("y1");
    await staffFinanceDashboard("t1");
    await staffDebtors("t1");

    for (const { init } of calls()) {
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.body).toBeUndefined();
    }
  });

  it("carries the bearer token on every call", async () => {
    await staffDebtors("t1");
    expect(new Headers(calls().at(-1)?.init.headers).get("Authorization")).toBe(
      "Bearer test-token",
    );
  });
});

describe("hasPermission", () => {
  it("honours the owner wildcard, matching every apps/web copy of this check", () => {
    expect(hasPermission(["*"], "finance.dashboard.read")).toBe(true);
  });

  it("matches an explicit grant and refuses anything else", () => {
    const bursar = ["finance.dashboard.read", "finance.debtors.read"];
    expect(hasPermission(bursar, "finance.debtors.read")).toBe(true);
    expect(hasPermission(bursar, "payment.refund")).toBe(false);
    expect(hasPermission([], "finance.dashboard.read")).toBe(false);
  });
});
