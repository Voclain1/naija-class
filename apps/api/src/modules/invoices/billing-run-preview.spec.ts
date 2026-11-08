import { describe, expect, it } from "vitest";
import { buildBillingPreview } from "./billing-run-preview.js";
const row = { studentId: "s", studentName: "Student", admissionNumber: "A1", snapshotHash: "first", feeItemCount: 1, chargeCount: 0, totalAmount: 2500031, totalDiscount: 0, totalDue: 2500031, alreadyInvoiced: false };
const input = { termId: "term", classArmIds: ["a"] };
describe("billing preview contract", () => {
  it("totals only newly billable students with bigint and reports skips", () => {
    const p = buildBillingPreview(input, [{ id: "a", label: "JSS2A", rows: [row, { ...row, studentId: "old", alreadyInvoiced: true }] }]);
    expect(p).toMatchObject({ createCount: 1, skipCount: 1, totalDueKobo: "2500031", blockers: [] });
    expect(p.arms[0]!.rows[0]).not.toHaveProperty("snapshotHash");
  });
  it("a same-total line-item change invalidates approval", () => {
    const a = buildBillingPreview(input, [{ id: "a", label: "JSS2A", rows: [row] }]);
    const b = buildBillingPreview(input, [{ id: "a", label: "JSS2A", rows: [{ ...row, snapshotHash: "renamed-line" }] }]);
    expect(a.totalDueKobo).toBe(b.totalDueKobo); expect(a.previewHash).not.toBe(b.previewHash);
  });
  it("roster order does not make a valid preview stale", () => {
    const rows = [row, { ...row, studentId: "another" }];
    expect(buildBillingPreview(input, [{ id: "a", label: "A", rows }]).previewHash).toBe(buildBillingPreview(input, [{ id: "a", label: "A", rows: [...rows].reverse() }]).previewHash);
  });
  it("blocks missing fees, allows explicit waivers and blocks empty runs", () => {
    expect(buildBillingPreview(input, [{ id: "a", label: "A", rows: [{ ...row, feeItemCount: 0 }] }]).blockers).toHaveLength(1);
    expect(buildBillingPreview(input, [{ id: "a", label: "A", rows: [{ ...row, totalDue: 0, totalDiscount: row.totalDue }] }]).blockers).toEqual([]);
    expect(buildBillingPreview(input, [{ id: "a", label: "A", rows: [] }]).blockers).toHaveLength(1);
  });
  it("binds the due date to approval", () => expect(buildBillingPreview(input, []).previewHash).not.toBe(buildBillingPreview({ ...input, dueDate: "2026-12-01" }, []).previewHash));
});
