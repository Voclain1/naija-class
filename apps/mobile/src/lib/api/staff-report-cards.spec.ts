import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, setTokenProvider } from "./client";
import { staffArmRoster } from "./staff-attendance";
import {
  staffGenerateFormComments,
  staffListFormComments,
  staffSaveFormComment,
} from "./staff-report-cards";
import { resetServerClock } from "../staff/server-date";

// CP7 wire contract for the form teacher's comment and the class roster.
//
// The split that matters here: `form/generate` drafts, and the WRITE is a
// PATCH on the report card itself — a different endpoint with its own auth,
// workflow gate and audit row. These assert the phone respects that split
// rather than inventing a shortcut through the comments surface.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", date: "Sun, 20 Sep 2026 09:30:00 GMT" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetServerClock();
  setTokenProvider(() => "test-token");
  fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse([])));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setTokenProvider(() => null);
  resetServerClock();
});

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init };
}

describe("form comment bindings", () => {
  it("lists a class's form comments for one term", async () => {
    await staffListFormComments({ classArmId: "arm-1", termId: "term-1" });
    const url = new URL(lastCall().url);
    expect(url.pathname).toMatch(/\/report-card-comments\/form$/);
    expect(url.searchParams.get("classArmId")).toBe("arm-1");
    expect(url.searchParams.get("termId")).toBe("term-1");
  });

  it("drafts for the whole class, never one child at a time", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ sessionRef: "r", queued: 2, skippedLocked: 1, skippedNoResults: 3 }),
      ),
    );
    const result = await staffGenerateFormComments({ classArmId: "arm-1", termId: "term-1" });
    const { url, init } = lastCall();
    expect(url).toMatch(/\/report-card-comments\/form\/generate$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ classArmId: "arm-1", termId: "term-1" });
    // The skip counts are what the screen tells the teacher about children who
    // got nothing, so they must survive the binding.
    expect(result).toMatchObject({ queued: 2, skippedLocked: 1, skippedNoResults: 3 });
  });

  it("saves through PATCH /report-cards/:id, not through the comments surface", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ id: "card-1" })));
    await staffSaveFormComment("card-1", "A steady term.");
    const { url, init } = lastCall();
    expect(url).toMatch(/\/report-cards\/card-1$/);
    expect(url).not.toContain("report-card-comments");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ formTeacherComment: "A steady term." });
  });

  it("encodes a report card id into the path", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ id: "x" })));
    await staffSaveFormComment("card/with space", "text");
    expect(lastCall().url).toContain("/report-cards/card%2Fwith%20space");
  });

  it("surfaces a locked card's refusal with its code", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: "REPORT_CARD_RELEASED", message: "Released." } },
          409,
        ),
      ),
    );
    const error = await staffSaveFormComment("card-1", "text").catch((e: unknown) => e);
    expect((error as ApiError).code).toBe("REPORT_CARD_RELEASED");
  });
});

describe("class roster binding", () => {
  it("reads one arm's roster through the teacher-scope route", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ data: [] })));
    await staffArmRoster("arm-1");
    const { url, init } = lastCall();
    // Not /students: the admin students surface is a wider DTO and a
    // permission teachers don't hold. Scope-limited route only.
    expect(url).toMatch(/\/teacher-scope\/me\/arms\/arm-1\/students$/);
    expect(init.method ?? "GET").toBe("GET");
  });

  it("encodes the arm id", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ data: [] })));
    await staffArmRoster("arm/1 2");
    expect(lastCall().url).toContain("/arms/arm%2F1%202/students");
  });
});
