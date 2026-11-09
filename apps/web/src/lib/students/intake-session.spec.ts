import { describe, expect, it, vi } from "vitest";
import type { PrepareStudentIntakeInput, StudentIntakeProposalDto } from "@school-kit/types";
import { ApiError, ApiNetworkError } from "@/lib/api-client";
import { IntakeSession } from "./intake-session";

const input: Omit<PrepareStudentIntakeInput, "clientRequestId"> = { placement: { mode: "DEFER" }, students: [{ firstName: "Ada", lastName: "Example", dateOfBirth: new Date("2012-05-04"), gender: "FEMALE" }] };
const preview = (extra: Partial<StudentIntakeProposalDto> = {}): StudentIntakeProposalDto => ({ id: "original", status: "PENDING", previewHash: "a".repeat(64), expiresAt: new Date(Date.now() + 60000).toISOString(), createdAt: new Date().toISOString(), confirmedAt: null, placement: { mode: "DEFER" }, counts: { rows: 1, withErrors: 0, withWarnings: 0, assignedOnConfirm: 1 }, batchErrors: [], batchWarnings: [], canConfirm: true, rows: [], dataCleared: false, duplicateRule: "Same first/last/DOB", outcome: null, ...extra });
const completed = () => preview({ status: "COMPLETED", canConfirm: false, rows: [], dataCleared: true, outcome: { createdCount: 1, enrolledCount: 0, students: [{ index: 0, studentId: "student", admissionNumber: "GI/1", enrollmentId: null }] } });
const lost = () => new ApiNetworkError();
const conflict = (code: string) => new ApiError(409, { code, message: code });
function fixture() {
  const api = { prepare: vi.fn().mockResolvedValue(preview()), get: vi.fn().mockResolvedValue(preview()), confirm: vi.fn().mockResolvedValue(completed()), refresh: vi.fn().mockResolvedValue(preview({ id: "refreshed" })) };
  let id = 0; const session = new IntakeSession(api, () => `request-${++id}`); return { api, session };
}
const tick = async () => { await new Promise((r) => setTimeout(r, 0)); };

describe("reviewed intake request identity and recovery", () => {
  it("prepares and confirms only the reviewed proposal", async () => {
    const { api, session } = fixture(); const result = session.start(input); await tick();
    expect(api.confirm).not.toHaveBeenCalled(); expect(session.snapshot().phase).toBe("review");
    await session.confirm(); expect(await result).toEqual(completed().outcome);
    expect(api.confirm).toHaveBeenCalledWith("original", "a".repeat(64));
  });
  it("retries a lost prepare with the same request id and payload", async () => {
    const { api, session } = fixture(); api.prepare.mockRejectedValueOnce(lost());
    const result = session.start(input); await tick(); expect(session.snapshot().phase).toBe("prepare-error");
    await session.prepare(); expect(api.prepare.mock.calls[0]).toEqual(api.prepare.mock.calls[1]); session.cancel(); expect(await result).toBeNull();
  });
  it("recovers a committed lost confirm by reading the original, never preparing again", async () => {
    const { api, session } = fixture(); api.confirm.mockRejectedValueOnce(lost()); api.get.mockResolvedValue(completed());
    const result = session.start(input); await tick(); await session.confirm();
    expect(await result).toEqual(completed().outcome); expect(api.prepare).toHaveBeenCalledTimes(1); expect(api.get).toHaveBeenCalledWith("original");
  });
  it("locks an unknown outcome until the original is readable", async () => {
    const { api, session } = fixture(); api.confirm.mockRejectedValueOnce(lost()); api.get.mockRejectedValueOnce(lost()).mockResolvedValueOnce(completed());
    const result = session.start(input); await tick(); await session.confirm(); session.cancel();
    expect(session.snapshot().phase).toBe("unknown"); await session.prepare(); await session.refresh();
    expect(api.prepare).toHaveBeenCalledTimes(1); expect(api.refresh).not.toHaveBeenCalled();
    await session.check(); expect(await result).toEqual(completed().outcome);
  });
  it("a recovered pending proposal needs a fresh human confirmation", async () => {
    const { api, session } = fixture(); api.confirm.mockRejectedValueOnce(lost());
    const result = session.start(input); await tick(); await session.confirm();
    expect(session.snapshot().phase).toBe("review"); expect(api.confirm).toHaveBeenCalledTimes(1);
    await session.confirm(); expect(await result).toEqual(completed().outcome);
  });
  it.each(["INTAKE_PREVIEW_STALE", "INTAKE_PREVIEW_MISMATCH", "INTAKE_EXPIRED", "INTAKE_RETRY"])("%s needs refresh and review, never auto-confirm", async (code) => {
    const { api, session } = fixture(); api.confirm.mockRejectedValueOnce(conflict(code));
    const result = session.start(input); await tick(); await session.confirm(); expect(session.snapshot().phase).toBe("refresh-needed");
    await session.refresh(); expect(session.snapshot().proposal?.id).toBe("refreshed"); expect(api.confirm).toHaveBeenCalledTimes(1);
    session.cancel(); await result;
  });
  it("retries a lost refresh with the same id", async () => {
    const { api, session } = fixture(); api.confirm.mockRejectedValueOnce(conflict("INTAKE_PREVIEW_STALE")); api.refresh.mockRejectedValueOnce(lost());
    const result = session.start(input); await tick(); await session.confirm(); await session.refresh(); await session.refresh();
    expect(api.refresh.mock.calls[0]).toEqual(api.refresh.mock.calls[1]); session.cancel(); await result;
  });
  it("re-prepares cleared expired rows only after an explicit server expiry response", async () => {
    const { api, session } = fixture(); api.confirm.mockRejectedValueOnce(conflict("INTAKE_EXPIRED")); api.refresh.mockRejectedValueOnce(conflict("INTAKE_EXPIRED"));
    const result = session.start(input); await tick(); await session.confirm(); await session.refresh();
    expect(api.prepare.mock.calls[1]![0].clientRequestId).toBe("request-2"); session.cancel(); await result;
  });
  it("does not confirm a blocked or expired preview", async () => {
    const { api, session } = fixture(); api.prepare.mockResolvedValueOnce(preview({ canConfirm: false }));
    const result = session.start(input); await tick(); await session.confirm(); expect(api.confirm).not.toHaveBeenCalled(); session.cancel(); await result;
    api.prepare.mockResolvedValueOnce(preview({ expiresAt: new Date(0).toISOString() }));
    const expired = session.start(input); await tick(); await session.confirm(); expect(api.confirm).not.toHaveBeenCalled(); session.cancel(); await expired;
  });
  it("does not accept a malformed completed outcome as safe to resend", async () => {
    const { api, session } = fixture(); api.confirm.mockResolvedValueOnce({ ...completed(), outcome: null });
    const result = session.start(input); await tick(); await session.confirm(); expect(session.snapshot().phase).toBe("unknown");
    session.dispose(); expect(await result).toBeNull();
  });
  it("disposal during a preview stops the UI and subsequent writes", async () => {
    const { api, session } = fixture(); const result = session.start(input); session.dispose(); await tick(); await session.confirm();
    expect(await result).toBeNull(); expect(api.confirm).not.toHaveBeenCalled();
  });
  it("guards duplicate confirmation clicks", async () => {
    const { api, session } = fixture(); const result = session.start(input); await tick(); await Promise.all([session.confirm(), session.confirm()]);
    expect(api.confirm).toHaveBeenCalledTimes(1); await result;
  });
});
