import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setTokenProvider } from "./client";
import {
  staffAttendanceRegister,
  staffMarkAttendance,
  staffTeacherScope,
} from "./staff-attendance";
import { resetServerClock, serverToday } from "../staff/server-date";

// Wire-contract regressions for CP2's three bindings.
//
// CP1 shipped a real client bug of exactly this shape: the staff auth wrapper
// JSON-encoded its body and the shared client encoded it again, so the API
// received a JSON *string* where it expected an object. It reached a real
// phone before anything caught it. These assertions pin the bytes on the wire,
// not just the fact that a function was called.

const SERVER_DATE = "Tue, 25 Aug 2026 09:30:00 GMT";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", date: SERVER_DATE },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetServerClock();
  setTokenProvider(() => "test-token");
  fetchMock = vi.fn();
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

describe("staff attendance bindings", () => {
  it("reads the teacher scope from the existing endpoint", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ classArms: [], formTeacherArmIds: [] }));
    await staffTeacherScope();
    expect(lastCall().url).toContain("/teacher-scope/me");
  });

  it("encodes register query parameters rather than interpolating them raw", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ records: [] }));
    await staffAttendanceRegister("arm/with space", "2026-08-25");
    const { url } = lastCall();
    expect(url).toContain("classArmId=arm%2Fwith+space");
    expect(url).toContain("date=2026-08-25");
  });

  it("sends the mark body as a JSON OBJECT, not a doubly-encoded string", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ count: 2 }));
    await staffMarkAttendance({
      classArmId: "arm_1",
      date: "2026-08-25",
      records: [
        { studentId: "s1", status: "PRESENT" },
        { studentId: "s2", status: "ABSENT" },
      ],
    });
    const { init } = lastCall();
    const parsed = JSON.parse(init.body as string) as unknown;
    // The CP1 bug would make this a string, not an object.
    expect(typeof parsed).toBe("object");
    expect(parsed).toEqual({
      classArmId: "arm_1",
      date: "2026-08-25",
      records: [
        { studentId: "s1", status: "PRESENT" },
        { studentId: "s2", status: "ABSENT" },
      ],
    });
    expect(init.method).toBe("POST");
  });

  it("carries the bearer token and posts to the existing mark route", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ count: 1 }));
    await staffMarkAttendance({
      classArmId: "arm_1",
      date: "2026-08-25",
      records: [{ studentId: "s1", status: "LATE" }],
    });
    const { url, init } = lastCall();
    expect(url).toContain("/attendance/mark");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-token");
  });

  it("establishes the server clock as a side effect of any staff request", async () => {
    expect(serverToday()).toBeNull();
    fetchMock.mockResolvedValue(jsonResponse({ classArms: [], formTeacherArmIds: [] }));
    await staffTeacherScope();
    // This is what makes the marking rail usable without a new endpoint: the
    // register load itself tells the phone what day the server thinks it is.
    expect(serverToday()).toBe("2026-08-25");
  });

  it("establishes the clock even when the request FAILS", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "FORBIDDEN", message: "no" } }, 403),
    );
    await expect(staffAttendanceRegister("arm_1", "2026-08-25")).rejects.toThrow();
    expect(serverToday()).toBe("2026-08-25");
  });
});
