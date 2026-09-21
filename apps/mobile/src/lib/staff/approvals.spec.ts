import type {
  CompletenessReportDto,
  ReportCardTransitionResultDto,
} from "@school-kit/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, setTokenProvider } from "../api/client";
import {
  staffApproveArm,
  staffCompleteness,
  staffReleaseArm,
  staffReopenArm,
  staffReportCardBoard,
} from "../api/staff-approvals";
import { armStage, describeStage, stageNeedsAction, type StatusCounts } from "./approval-stage";
import { resetServerClock } from "./server-date";

const ZERO: StatusCounts = {
  DRAFT: 0,
  SUBJECT_REVIEWED: 0,
  FORM_REVIEWED: 0,
  PRINCIPAL_APPROVED: 0,
  RELEASED: 0,
};

describe("armStage — mirrors the server's all-cards-in-state rule", () => {
  it("is not built when there are no cards", () => {
    expect(armStage(ZERO)).toBe("NOT_BUILT");
  });

  it("is ready to approve only when EVERY card is form-reviewed", () => {
    expect(armStage({ ...ZERO, FORM_REVIEWED: 40 })).toBe("READY_TO_APPROVE");
  });

  it("is NOT ready when one card is still with a teacher", () => {
    // The server would 409 this with INVALID_TRANSITION. Offering the button
    // would hand the head an error they cannot act on.
    expect(armStage({ ...ZERO, FORM_REVIEWED: 39, SUBJECT_REVIEWED: 1 })).toBe("WITH_TEACHERS");
  });

  it("is ready to release only when every card is approved", () => {
    expect(armStage({ ...ZERO, PRINCIPAL_APPROVED: 40 })).toBe("READY_TO_RELEASE");
    expect(armStage({ ...ZERO, PRINCIPAL_APPROVED: 39, FORM_REVIEWED: 1 })).toBe("WITH_TEACHERS");
  });

  it("is released only when every card is released", () => {
    expect(armStage({ ...ZERO, RELEASED: 40 })).toBe("RELEASED");
  });

  it("puts the two stages that need the head first", () => {
    expect(stageNeedsAction("READY_TO_APPROVE")).toBe(true);
    expect(stageNeedsAction("READY_TO_RELEASE")).toBe(true);
    expect(stageNeedsAction("WITH_TEACHERS")).toBe(false);
    expect(stageNeedsAction("RELEASED")).toBe(false);
  });

  it("says how many are still with teachers, not just 'in progress'", () => {
    expect(describeStage("WITH_TEACHERS", { ...ZERO, DRAFT: 3, FORM_REVIEWED: 37 })).toBe(
      "With teachers — 3 of 40 not yet reviewed by the form teacher",
    );
  });
});

// ---------------------------------------------------------------------------
// Bindings. Fixtures are typed from the API's own DTOs (the curriculum-crash
// rule), covering exactly the fields the screens read.

type PipelineFields = Pick<CompletenessReportDto, "term" | "reportCards">;

const PIPELINE: PipelineFields = {
  term: {
    id: "term-1",
    name: "First Term",
    academicYearLabel: "2026/2027",
    startDate: "2026-09-07",
    endDate: "2026-12-11",
    isCurrent: true,
  } as CompletenessReportDto["term"],
  reportCards: {
    rows: [
      {
        groupId: "arm-1",
        label: "JSS 2A",
        classLevelName: "JSS 2",
        enrolledCount: 40,
        byStatus: { ...ZERO, FORM_REVIEWED: 40 },
        studentsWithoutCard: 0,
      },
    ],
    totals: { byStatus: { ...ZERO, FORM_REVIEWED: 40 }, studentsWithoutCard: 0 },
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("approval bindings", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetServerClock();
    setTokenProvider(() => "test-token");
    fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(PIPELINE)));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTokenProvider(() => null);
  });

  function lastCall(): { url: string; init: RequestInit } {
    const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
    return { url, init };
  }

  it("reads the whole-school pipeline in ONE call, defaulting to the current term (D34)", async () => {
    const result = await staffCompleteness();
    expect(lastCall().url).toMatch(/\/reports\/completeness$/);
    // groupId is the class arm id, which the per-class screen is keyed by.
    expect(result.reportCards?.rows[0]?.groupId).toBe("arm-1");
    expect(result.term?.id).toBe("term-1");
  });

  it("passes a term when one is given", async () => {
    await staffCompleteness("term-9");
    expect(new URL(lastCall().url).searchParams.get("termId")).toBe("term-9");
  });

  it("reads one class's board only when asked", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ data: [] })));
    await staffReportCardBoard("term-1", "arm-1");
    const url = new URL(lastCall().url);
    expect(url.pathname).toMatch(/\/report-cards$/);
    expect(url.searchParams.get("classArmId")).toBe("arm-1");
  });

  it("approves and releases a whole class, not one card", async () => {
    const result: ReportCardTransitionResultDto = { status: "PRINCIPAL_APPROVED", cardCount: 40 };
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(result)));

    await staffApproveArm({ termId: "term-1", classArmId: "arm-1" });
    expect(lastCall().url).toMatch(/\/report-cards\/arm\/approve$/);
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ termId: "term-1", classArmId: "arm-1" });

    await staffReleaseArm({ termId: "term-1", classArmId: "arm-1" });
    expect(lastCall().url).toMatch(/\/report-cards\/arm\/release$/);
  });

  it("sends the reason a reopen requires", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ status: "DRAFT", cardCount: 40 })),
    );
    await staffReopenArm({ termId: "term-1", classArmId: "arm-1", reason: "Maths marks wrong" });
    expect(JSON.parse(String(lastCall().init.body)).reason).toBe("Maths marks wrong");
  });

  it("surfaces the server's refusal when the phone and server disagree", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: "INVALID_TRANSITION", message: "Cannot approve: the arm is in state(s) [SUBJECT_REVIEWED]" } },
          409,
        ),
      ),
    );
    const error = await staffApproveArm({ termId: "t", classArmId: "a" }).catch((e: unknown) => e);
    expect((error as ApiError).code).toBe("INVALID_TRANSITION");
  });
});
