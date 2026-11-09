import { describe, expect, it, vi } from "vitest";
import type { BillingRunDto, StudentCorrectionProposalDto } from "@school-kit/types";

import { ApiError } from "@/lib/api-client";
import { CorrectionSession } from "./correction-session";
import { resolveTermHint } from "./hints";
import { parsePastedRows } from "./intake-task";
import { InvoiceRunSession } from "./invoice-session";

const future = new Date(Date.now() + 600_000).toISOString();
const run = (over: Partial<BillingRunDto> = {}): BillingRunDto => ({
  id: "run-1", status: "PENDING", termId: "t", termLabel: "2026/2027 · First Term", academicYearId: "y", dueDate: null, previewHash: "h".repeat(64),
  expiresAt: future, createdAt: future, approvedAt: null, arms: [], createCount: 2, skipCount: 0, totalDueKobo: "100", blockers: [], result: null, ...over,
});
const proposal = (over: Partial<StudentCorrectionProposalDto> = {}): StudentCorrectionProposalDto => ({
  id: "prop-1", status: "PENDING", previewHash: "a".repeat(64), expiresAt: future, createdAt: future, confirmedAt: null,
  counts: { rows: 1, withErrors: 0, withWarnings: 0, toUpdate: 1, fieldChanges: 1, clears: 0 }, batchErrors: [], canConfirm: true, rows: [], dataCleared: false, outcome: null, ...over,
});

describe("invoice run session", () => {
  it("a lost approval reads the ORIGINAL run, never approving twice", async () => {
    const api = { prepare: vi.fn(async () => run()), approve: vi.fn(async () => { throw new TypeError("network"); }), get: vi.fn(async () => run({ status: "COMPLETED", result: { created: 2, skipped: 0, totalDueKobo: "100", invoiceIds: [] } })) };
    const s = new InvoiceRunSession(api);
    await s.prepare({ termId: "t", classArmIds: ["a"] });
    expect(s.snapshot().phase).toBe("review");
    await s.approve();
    expect(api.approve).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith("run-1");
    expect(s.snapshot().phase).toBe("done");
    await s.approve();
    expect(api.approve).toHaveBeenCalledTimes(1);
  });
  it("a changed preview needs an explicit fresh preview", async () => {
    const api = { prepare: vi.fn(async () => run()), approve: vi.fn(async () => { throw new ApiError(409, { code: "BILLING_PREVIEW_CHANGED", message: "changed" }); }), get: vi.fn() };
    const s = new InvoiceRunSession(api);
    await s.prepare({ termId: "t", classArmIds: ["a"] });
    await s.approve();
    expect(s.snapshot().phase).toBe("stale");
    expect(api.prepare).toHaveBeenCalledTimes(1);
    await s.refresh();
    expect(api.prepare).toHaveBeenCalledTimes(2);
    expect(s.snapshot().phase).toBe("review");
  });
});

describe("correction session", () => {
  it("keeps one clientRequestId per batch, recovers a lost confirm from the original proposal", async () => {
    const api = {
      prepare: vi.fn(async () => proposal()),
      confirm: vi.fn(async () => { throw new TypeError("network"); }),
      get: vi.fn(async () => proposal({ status: "COMPLETED", outcome: { updatedCount: 1, students: [{ studentId: "s", changed: ["firstName"] }] } })),
      refresh: vi.fn(),
    };
    const s = new CorrectionSession(api, () => "uuid-1");
    await s.prepare([{ studentId: "s", changes: { firstName: "Ada" } }]);
    expect(api.prepare).toHaveBeenCalledWith({ clientRequestId: "uuid-1", corrections: [{ studentId: "s", changes: { firstName: "Ada" } }] });
    await s.confirm();
    expect(api.get).toHaveBeenCalledWith("prop-1");
    expect(s.snapshot()).toMatchObject({ phase: "done", proposal: { outcome: { updatedCount: 1 } } });
    expect(api.confirm).toHaveBeenCalledTimes(1);
  });
  it("a stale preview refreshes on request with a reused refresh id", async () => {
    let n = 0;
    const api = {
      prepare: vi.fn(async () => proposal()),
      confirm: vi.fn(async () => { throw new ApiError(409, { code: "CORRECTION_PREVIEW_STALE", message: "stale" }); }),
      get: vi.fn(),
      refresh: vi.fn(async (_id: string, _clientRequestId: string) => { n += 1; if (n === 1) throw new TypeError("network"); return proposal({ id: "prop-2" }); }),
    };
    const ids = ["batch", "refresh-1", "never"];
    const s = new CorrectionSession(api, () => ids.shift()!);
    await s.prepare([{ studentId: "s", changes: { lastName: "Eze" } }]);
    await s.confirm();
    expect(s.snapshot().phase).toBe("refresh-needed");
    await s.refresh();
    expect(s.snapshot().phase).toBe("refresh-error");
    await s.refresh();
    expect(api.refresh.mock.calls.map((c) => c[1])).toEqual(["refresh-1", "refresh-1"]);
    expect(s.snapshot()).toMatchObject({ phase: "review", proposal: { id: "prop-2" } });
  });
});

describe("helpers", () => {
  it("resolves term hints within the current year only", () => {
    const terms = [
      { id: "a", name: "First Term", isCurrent: true, sequence: 1, academicYearId: "y1" },
      { id: "b", name: "Second Term", isCurrent: false, sequence: 2, academicYearId: "y1" },
      { id: "c", name: "Second Term", isCurrent: false, sequence: 2, academicYearId: "y0" },
    ];
    expect(resolveTermHint(terms, undefined)).toBe("a");
    expect(resolveTermHint(terms, "next")).toBe("b");
    expect(resolveTermHint(terms, 2)).toBe("b");
    expect(resolveTermHint(terms, 3)).toBeNull();
  });
  it("parses pasted rows without guessing missing values", () => {
    const { rows, skipped } = parsePastedRows("First,Last,DOB,Gender\nAda,Okafor,12/03/2014,F\nBola,Eze,2013-01-05,male,ADM-9\nOnly");
    expect(skipped).toBe(2);
    expect(rows).toEqual([
      { firstName: "Ada", lastName: "Okafor", dateOfBirth: "2014-03-12", gender: "FEMALE", admissionNumber: "" },
      { firstName: "Bola", lastName: "Eze", dateOfBirth: "2013-01-05", gender: "MALE", admissionNumber: "ADM-9" },
    ]);
  });
});
