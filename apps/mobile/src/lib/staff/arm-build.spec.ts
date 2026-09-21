import {
  buildReportCardsSchema,
  principalNoteUpdateSchema,
  type BuildReportCardsResultDto,
  type PrincipalNoteResultDto,
} from "@school-kit/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setTokenProvider } from "../api/client";
import { staffBuildArm, staffSetPrincipalNote } from "../api/staff-approvals";
import {
  armStage,
  canBuildArm,
  canEditPrincipalNote,
  principalNoteValue,
  type StatusCounts,
} from "./approval-stage";

const ZERO: StatusCounts = {
  DRAFT: 0,
  SUBJECT_REVIEWED: 0,
  FORM_REVIEWED: 0,
  PRINCIPAL_APPROVED: 0,
  RELEASED: 0,
};

describe("canBuildArm — mirrors ReportCardService.build's ARM_NOT_DRAFT guard", () => {
  it("allows a first build and a rebuild while every card is a draft", () => {
    expect(canBuildArm(ZERO)).toBe(true);
    expect(canBuildArm({ ...ZERO, DRAFT: 30 })).toBe(true);
  });

  it("refuses once ANY card has moved on — a rebuild would re-snapshot reviewed results", () => {
    expect(canBuildArm({ ...ZERO, DRAFT: 29, SUBJECT_REVIEWED: 1 })).toBe(false);
    expect(canBuildArm({ ...ZERO, FORM_REVIEWED: 30 })).toBe(false);
    expect(canBuildArm({ ...ZERO, RELEASED: 30 })).toBe(false);
  });
});

describe("canEditPrincipalNote — FORM_REVIEWED only, as editPrincipalNote requires", () => {
  it("is open exactly when the class is ready for approval", () => {
    expect(canEditPrincipalNote(armStage({ ...ZERO, FORM_REVIEWED: 30 }))).toBe(true);
    expect(canEditPrincipalNote(armStage({ ...ZERO, FORM_REVIEWED: 29, DRAFT: 1 }))).toBe(false);
    expect(canEditPrincipalNote(armStage({ ...ZERO, PRINCIPAL_APPROVED: 30 }))).toBe(false);
    expect(canEditPrincipalNote(armStage(ZERO))).toBe(false);
  });

  it("sends a blank note as null, and trims", () => {
    expect(principalNoteValue("   ")).toBeNull();
    expect(principalNoteValue(" Well done, JSS2. ")).toBe("Well done, JSS2.");
  });
});

describe("build and note bindings", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const BUILT: BuildReportCardsResultDto = { cardCount: 30, studentCount: 30 };
  const NOTED: PrincipalNoteResultDto = { cardCount: 30 };

  beforeEach(() => {
    setTokenProvider(() => "test-token");
    fetchMock = vi.fn();
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

  it("builds with exactly the body the API's strict schema accepts", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(BUILT), { status: 200 }));
    const input = { termId: "term-1", classArmId: "arm-1" };
    const result = await staffBuildArm(input);
    const { url, init } = lastCall();
    expect(url).toMatch(/\/report-cards\/arm\/build$/);
    expect(init.method).toBe("POST");
    expect(buildReportCardsSchema.safeParse(JSON.parse(init.body as string)).success).toBe(true);
    expect(result.cardCount).toBe(30);
  });

  it("PUTs the principal's note, and a cleared note as null", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(NOTED), { status: 200 }));
    await staffSetPrincipalNote({ termId: "term-1", classArmId: "arm-1", principalNote: principalNoteValue("") });
    const { url, init } = lastCall();
    expect(url).toMatch(/\/report-cards\/arm\/principal-note$/);
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.principalNote).toBeNull();
    expect(principalNoteUpdateSchema.safeParse(body).success).toBe(true);
  });
});
