import { describe, expect, it } from "vitest";
import type { DebtorDto, SendRemindersResult } from "@school-kit/types";
import { DEFAULT_REMINDER_FILTERS as defaults, reminderAudience, reminderBatches, validReminderResult } from "./audience";
const row = (patch: Partial<DebtorDto> = {}): DebtorDto => ({ studentId: "a", invoiceId: "i1", studentName: "Ada Example", admissionNumber: "A1", classArm: "JSS 2 A", totalDue: 5000000, totalPaid: 0, balance: 5000000, status: "OVERDUE", dueDate: "2026-01-01", hasPaymentPlan: false, supplementary: false, risk: { level: "LOW", reasons: [] }, ...patch });
describe("fee reminder audience", () => {
  it("deduplicates students while retaining separate invoice balances", () => {
    const rows = [row(), row({ invoiceId: "i2", supplementary: true, balance: 70000 })];
    const audience = reminderAudience(rows, defaults); expect(audience).toHaveLength(1);
    expect(audience[0]!.invoices.map((i) => i.balance)).toEqual([5000000, 70000]);
  });
  it("excludes the whole student if any outstanding invoice has a plan", () => {
    const rows = [row(), row({ invoiceId: "i2", hasPaymentPlan: true })];
    expect(reminderAudience(rows, defaults)).toEqual([]);
    expect(reminderAudience(rows, { ...defaults, excludePlans: false })).toHaveLength(1);
  });
  it("uses overdue status, never guesses it from a date", () => {
    const rows = [row({ status: "ISSUED" })]; expect(reminderAudience(rows, defaults)).toEqual([]);
    expect(reminderAudience(rows, { ...defaults, overdueOnly: false })).toHaveLength(1);
  });
  it("searches student names/admission numbers and filters class and risk", () => {
    const rows = [row(), row({ studentId: "b", studentName: "Bello Example", admissionNumber: "B2", classArm: "SS 1", risk: { level: "HIGH", reasons: [] } })];
    expect(reminderAudience(rows, { ...defaults, search: "b2", classArm: "SS 1", risk: "HIGH" }).map((s) => s.studentId)).toEqual(["b"]);
    expect(reminderAudience(rows, { ...defaults, search: "Bello", risk: "LOW" })).toHaveLength(0);
  });
  it("drops zero balances and preserves input data", () => {
    const rows = [row(), row({ studentId: "paid", balance: 0 })]; const before = structuredClone(rows);
    expect(reminderAudience(rows, defaults)).toHaveLength(1); expect(rows).toEqual(before);
  });
  it.each([0, 1, 50, 51, 100, 500])("batches %i unique students in at most 50 each", (n) => {
    const ids = Array.from({ length: n }, (_, i) => `${i}`); const batches = reminderBatches([...ids, ...ids]);
    expect(batches.flat()).toEqual(ids); expect(batches.every((b) => b.length <= 50)).toBe(true);
  });
});
const result: SendRemindersResult = { sent: 1, skipped: 2, skippedBy: { NO_BALANCE: 0, NO_GUARDIAN: 1, NO_CONTACT: 0, NOT_DELIVERED: 1 }, noChannel: false };
describe("reminder result reconciliation", () => {
  it("accepts the API's complete student count", () => expect(validReminderResult(result, 3)).toBe(true));
  it.each([{ ...result, sent: 3 }, { ...result, skipped: -1 }, { ...result, sent: 0.5 }, { ...result, skippedBy: { ...result.skippedBy, NO_GUARDIAN: 0 } }])("refuses an unverified result", (r) => expect(validReminderResult(r, 3)).toBe(false));
});
