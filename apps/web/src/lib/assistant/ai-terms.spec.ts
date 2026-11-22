import type { SchoolAiTermsDto } from "@school-kit/types";
import { describe, expect, it } from "vitest";

import { aiTermsView } from "./ai-terms";

const base: SchoolAiTermsDto = { currentVersion: "2026-11-22", points: ["x"], accepted: false, latest: null, canDecide: false };

describe("aiTermsView", () => {
  it("loading, then not accepted, never says AI is on", () => {
    expect(aiTermsView(null)).toEqual({ kind: "loading" });
    const v = aiTermsView(base);
    expect(v).toMatchObject({ kind: "needed", canDecide: false });
    expect(v.kind === "needed" && v.text).toMatch(/cannot be used/);
  });
  it("accepted says only SchoolKit switches it on", () => {
    const v = aiTermsView({ ...base, accepted: true, canDecide: true, latest: { action: "ACCEPT", version: "2026-11-22", at: "2026-11-22T10:00:00Z", byName: "Ada Obi" } });
    expect(v.kind === "accepted" && v.text).toMatch(/Ada Obi.*Only SchoolKit can switch/);
  });
  it("withdrawn and out-of-date acceptances ask again", () => {
    expect(aiTermsView({ ...base, latest: { action: "WITHDRAW", version: "2026-11-22", at: "2026-11-22T10:00:00Z", byName: null } })).toMatchObject({ kind: "needed" });
    const old = aiTermsView({ ...base, canDecide: true, latest: { action: "ACCEPT", version: "2026-01-01", at: "2026-01-02T10:00:00Z", byName: null } });
    expect(old).toMatchObject({ kind: "needed", canDecide: true });
    expect(old.kind === "needed" && old.text).toMatch(/changed/);
  });
});
