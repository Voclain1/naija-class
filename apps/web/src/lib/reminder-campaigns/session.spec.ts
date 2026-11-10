import { describe, expect, it, vi } from "vitest";
import type { DebtorDto, SendRemindersResult } from "@school-kit/types";
import { ReminderCampaignSession, type CampaignRequest } from "./session";
import { DEFAULT_REMINDER_FILTERS } from "./audience";
const rows = (n: number): DebtorDto[] => Array.from({ length: n }, (_, i) => ({ studentId: `${i}`, invoiceId: `invoice-${i}`, studentName: `Student ${i}`, admissionNumber: `${i}`, classArm: "JSS 2 A", classArmId: "arm-a", classLevel: "JSS 2", totalDue: 5000000, totalPaid: 0, balance: 5000000, status: "OVERDUE", dueDate: null, hasPaymentPlan: false, supplementary: false, risk: { level: "LOW", reasons: [] } }));
const response = (n: number): SendRemindersResult => ({ sent: n, skipped: 0, skippedBy: { NO_BALANCE: 0, NO_GUARDIAN: 0, NO_CONTACT: 0, NOT_DELIVERED: 0 }, noChannel: false });
function fixture(n = 51, canReadChannels = true) {
  const api = { list: vi.fn().mockResolvedValue(rows(n)), send: vi.fn().mockImplementation(async (input) => response(input.studentIds.length)), channels: vi.fn().mockResolvedValue({ emailEnabled: true, smsEnabled: false, pushEnabled: false, updatedBy: null, updatedAt: null }) };
  const request: CampaignRequest = { termId: "term", termLabel: "First term", studentIds: rows(n).map((r) => r.studentId), filters: { ...DEFAULT_REMINDER_FILTERS }, canReadChannels };
  return { api, request, session: new ReminderCampaignSession(api) };
}
describe("reminder run lifecycle", () => {
  it("review makes no send and rechecks selected students", async () => {
    const { api, request, session } = fixture(3); api.list.mockResolvedValueOnce(rows(2));
    await session.open(request); expect(api.send).not.toHaveBeenCalled(); expect(session.snapshot().removed).toBe(1); expect(session.snapshot().recipients).toHaveLength(2);
  });
  it("splits a run into sequential 50-student requests for the reviewed term", async () => {
    const { api, request, session } = fixture(); await session.open(request); await session.send();
    expect(api.send.mock.calls.map(([v]) => v.studentIds.length)).toEqual([50, 1]); expect(api.send.mock.calls.every(([v]) => v.termId === "term")).toBe(true);
    expect(session.snapshot().phase).toBe("done"); expect(session.snapshot().batches.every((b) => b.status === "confirmed")).toBe(true);
  });
  it("retains earlier results and stops after an unknown second batch with no retries", async () => {
    const { api, request, session } = fixture(101); api.send.mockResolvedValueOnce(response(50)).mockRejectedValueOnce(new Error("lost response"));
    await session.open(request); await session.send(); await session.send(); session.close(); await session.open(request);
    expect(api.send).toHaveBeenCalledTimes(2); expect(session.snapshot().phase).toBe("uncertain");
    expect(session.snapshot().batches.map((b) => b.status)).toEqual(["confirmed", "uncertain", "waiting"]);
    expect(session.snapshot().batches[0]!.result?.sent).toBe(50);
  });
  it("malformed success also stops as uncertain", async () => {
    const { api, request, session } = fixture(1); api.send.mockResolvedValueOnce(response(0)); await session.open(request); await session.send(); expect(session.snapshot().phase).toBe("uncertain");
  });
  it("stops remaining batches when the server says no channel is available", async () => {
    const { api, request, session } = fixture(); api.send.mockResolvedValueOnce({ sent: 0, skipped: 50, skippedBy: { NO_BALANCE: 0, NO_GUARDIAN: 0, NO_CONTACT: 0, NOT_DELIVERED: 0 }, noChannel: true });
    // Existing no-channel response does not classify skips; the validator must
    // accept this documented special case without pretending any send succeeded.
    await session.open(request); await session.send(); expect(api.send).toHaveBeenCalledTimes(1); expect(session.snapshot().phase).toBe("done");
  });
  it("does not fetch settings that the user cannot read", async () => {
    const { api, request, session } = fixture(1, false); await session.open(request); expect(api.channels).not.toHaveBeenCalled(); expect(session.snapshot().channels).toBeNull();
  });
  it("blocks sends when every known channel is off", async () => {
    const { api, request, session } = fixture(1); api.channels.mockResolvedValueOnce({ emailEnabled: false, smsEnabled: false, pushEnabled: false });
    await session.open(request); await session.send(); expect(api.send).not.toHaveBeenCalled();
  });
  it("guards double-clicks and does not resend a completed run", async () => {
    const { api, request, session } = fixture(1); await session.open(request); await Promise.all([session.send(), session.send()]); await session.send(); expect(api.send).toHaveBeenCalledTimes(1);
  });
  it("allows a failed preview to retry without sending", async () => {
    const { api, request, session } = fixture(1); api.list.mockRejectedValueOnce(new Error("offline")); await session.open(request); expect(session.snapshot().phase).toBe("load-error"); await session.load(); expect(session.snapshot().phase).toBe("review"); expect(api.send).not.toHaveBeenCalled();
  });
  it("does not start another batch after account disposal", async () => {
    const { api, request, session } = fixture(); api.send.mockImplementationOnce(async () => { session.dispose(); return response(50); });
    await session.open(request); await session.send(); expect(api.send).toHaveBeenCalledTimes(1);
  });
});
