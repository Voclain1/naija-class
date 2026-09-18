import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, ApiNetworkError, setTokenProvider } from "./client";
import {
  staffGradebookFeed,
  staffGradingScheme,
  staffSaveScores,
  staffSignOffColumn,
} from "./staff-gradebook";
import { resetServerClock } from "../staff/server-date";

// Wire-contract regressions for CP6a's four bindings. The paths and bodies
// must match what the web teacher gradebook already sends, because CP6a adds
// no server surface.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", date: "Thu, 17 Sep 2026 09:30:00 GMT" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetServerClock();
  setTokenProvider(() => "test-token");
  fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ data: [] })));
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

describe("staff gradebook bindings", () => {
  it("reads the grading scheme", async () => {
    await staffGradingScheme();
    expect(lastCall().url).toMatch(/\/grading-scheme$/);
  });

  it("reads one column with all three scope parameters", async () => {
    await staffGradebookFeed("term 1", "arm&1", "subject-1");
    const url = new URL(lastCall().url);
    expect(url.pathname).toMatch(/\/assessments$/);
    expect(url.searchParams.get("termId")).toBe("term 1");
    expect(url.searchParams.get("classArmId")).toBe("arm&1");
    expect(url.searchParams.get("subjectId")).toBe("subject-1");
  });

  it("saves through the atomic bulk endpoint with the exact body given", async () => {
    const input = {
      termId: "t",
      subjectId: "s",
      rows: [{ studentId: "a", componentId: "c", score: 17 }],
    };
    await staffSaveScores(input);
    const { url, init } = lastCall();
    expect(url).toMatch(/\/assessment-scores\/bulk$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it("signs a column off through the bulk sign-off endpoint", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse([])));
    await staffSignOffColumn({ termId: "t", subjectId: "s", classArmId: "a" });
    const { url, init } = lastCall();
    expect(url).toMatch(/\/assessments\/sign-off\/bulk$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ termId: "t", subjectId: "s", classArmId: "a" });
  });

  it("sends the bearer token", async () => {
    await staffGradingScheme();
    expect(new Headers(lastCall().init.headers).get("Authorization")).toBe("Bearer test-token");
  });

  it("surfaces a released report card as an ApiError carrying its code", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: "REPORT_CARD_RELEASED", message: "This report card has been released." } },
          409,
        ),
      ),
    );
    const error = await staffSaveScores({
      termId: "t",
      subjectId: "s",
      rows: [{ studentId: "a", componentId: "c", score: 1 }],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).code).toBe("REPORT_CARD_RELEASED");
  });

  it("does not retry a save that never reached the server", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("Network request failed")));
    const error = await staffSaveScores({
      termId: "t",
      subjectId: "s",
      rows: [{ studentId: "a", componentId: "c", score: 1 }],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiNetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
