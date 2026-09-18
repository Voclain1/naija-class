import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, setTokenProvider } from "./client";
import {
  staffAcceptSubjectComment,
  staffGenerateSubjectComments,
  staffListSubjectComments,
} from "./staff-comments";
import { resetServerClock } from "../staff/server-date";

// CP6b wire contract. The split between `generate` (a suggestion) and `accept`
// (the only writer of Assessment.subjectComment) IS the AI approval gate, so
// these assert that the phone calls them as two separate, teacher-driven
// steps and never invents a third path.

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

describe("staff subject-comment bindings", () => {
  it("lists a column's comments with all three scope parameters", async () => {
    await staffListSubjectComments({ classArmId: "a", subjectId: "s", termId: "t" });
    const url = new URL(lastCall().url);
    expect(url.pathname).toMatch(/\/report-card-comments$/);
    expect(url.searchParams.get("classArmId")).toBe("a");
    expect(url.searchParams.get("subjectId")).toBe("s");
    expect(url.searchParams.get("termId")).toBe("t");
    expect(lastCall().init.method ?? "GET").toBe("GET");
  });

  it("asks for a whole-arm batch, never one student at a time", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ sessionRef: "r", queued: 3, skippedSignedOff: 1, skippedNoScores: 2 }),
      ),
    );
    const result = await staffGenerateSubjectComments({
      classArmId: "a",
      subjectId: "s",
      termId: "t",
    });
    const { url, init } = lastCall();
    expect(url).toMatch(/\/report-card-comments\/generate$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ classArmId: "a", subjectId: "s", termId: "t" });
    // The skip counts are what the screen tells the teacher about students who
    // got nothing, so they must survive the binding.
    expect(result).toMatchObject({ queued: 3, skippedSignedOff: 1, skippedNoScores: 2 });
  });

  it("accepts the teacher's edited text, not the stored suggestion", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ studentId: "st" })));
    await staffAcceptSubjectComment({
      studentId: "st",
      subjectId: "s",
      termId: "t",
      comment: "Rewrote this entirely.",
    });
    const { url, init } = lastCall();
    expect(url).toMatch(/\/report-card-comments\/accept$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      studentId: "st",
      subjectId: "s",
      termId: "t",
      comment: "Rewrote this entirely.",
    });
  });

  it("surfaces an AI-unavailable refusal with its code, not a generic failure", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: "AI_DISABLED_SCHOOL", message: "AI is disabled for this school." } },
          403,
        ),
      ),
    );
    const error = await staffGenerateSubjectComments({
      classArmId: "a",
      subjectId: "s",
      termId: "t",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("AI_DISABLED_SCHOOL");
    expect((error as ApiError).status).toBe(403);
  });

  it("surfaces a signed-off refusal on accept", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "SUBJECT_SIGNED_OFF", message: "Signed off." } }, 409),
      ),
    );
    const error = await staffAcceptSubjectComment({
      studentId: "st",
      subjectId: "s",
      termId: "t",
      comment: "x",
    }).catch((e: unknown) => e);
    expect((error as ApiError).code).toBe("SUBJECT_SIGNED_OFF");
  });
});
