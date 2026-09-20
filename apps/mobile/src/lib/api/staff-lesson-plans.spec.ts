import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setTokenProvider } from "./client";
import {
  staffCreateLessonPlan,
  staffGenerateQuiz,
  staffGetLessonPlan,
  staffListLessonPlans,
  staffUpdateLessonPlan,
} from "./staff-lesson-plans";
import { resetServerClock } from "../staff/server-date";

// CP7 (4) wire contract. The one that matters most is CANCEL: D25 promises the
// teacher can stop a 10-30 s generation, and a promise that only looks
// cancelled while the request continues underneath would be worse than not
// offering it.

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
  fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ id: "plan-1" })));
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

describe("lesson note bindings", () => {
  it("lists the teacher's own notes without widening the query", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse([])));
    await staffListLessonPlans();
    const { url } = lastCall();
    // `mine` defaults server-side; sending a widening flag from a teacher
    // surface would be asking for other people's work.
    expect(url).toMatch(/\/lesson-plans$/);
    expect(url).not.toContain("mine=false");
  });

  it("reads and encodes one note's id", async () => {
    await staffGetLessonPlan("plan/1 2");
    expect(lastCall().url).toContain("/lesson-plans/plan%2F1%202");
  });

  it("creates a note with the class level, not the class arm", async () => {
    // Curriculum lives at the class LEVEL — a JSS 2 scheme of work serves both
    // JSS 2 A and JSS 2 B — so the arm would be the wrong grain to model
    // against, which is why teacher scope carries classLevelId.
    await staffCreateLessonPlan({
      classLevelId: "level-1",
      subjectId: "subject-1",
      topic: "Photosynthesis",
    });
    const { url, init } = lastCall();
    expect(url).toMatch(/\/lesson-plans$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      classLevelId: "level-1",
      subjectId: "subject-1",
      topic: "Photosynthesis",
    });
  });

  it("passes the abort signal through, so Stop actually stops the request", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      // Behave like fetch: reject when the caller's signal aborts.
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });

    const pending = staffCreateLessonPlan(
      { classLevelId: "level-1", subjectId: "subject-1", topic: "Photosynthesis" },
      controller.signal,
    );
    controller.abort();

    const error = await pending.catch((e: unknown) => e);
    expect((error as Error).name).toBe("AbortError");
    // The signal must reach fetch itself. If it were dropped here, Stop would
    // update the screen while the model call carried on underneath.
    expect(lastCall().init.signal).toBeDefined();
  });

  it("generates a quiz against an existing note, cancellably", async () => {
    const controller = new AbortController();
    await staffGenerateQuiz("plan-1", controller.signal);
    const { url, init } = lastCall();
    expect(url).toMatch(/\/lesson-plans\/plan-1\/quiz$/);
    expect(init.method).toBe("POST");
    expect(init.signal).toBeDefined();
  });

  it("saves ONE section at a time", async () => {
    await staffUpdateLessonPlan("plan-1", { mainContent: "Rewritten." });
    const { url, init } = lastCall();
    expect(url).toMatch(/\/lesson-plans\/plan-1$/);
    expect(init.method).toBe("PATCH");
    // Only the edited section travels: sending the whole note back would make
    // two teachers editing different sections overwrite each other.
    expect(JSON.parse(String(init.body))).toEqual({ mainContent: "Rewritten." });
  });
});
