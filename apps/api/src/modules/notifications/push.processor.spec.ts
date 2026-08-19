import { beforeEach, describe, expect, it, vi } from "vitest";

import { PushProcessor } from "./push.processor";
import { PUSH_JOB_RECEIPTS, PUSH_JOB_SEND } from "../../common/queue";

// Phase 6 / Slice 5 — D39, the half of push that is invisible when wrong.
//
// A dead token that survives makes notifyGuardian believe a parent is
// reachable by push forever. Nothing errors, no test fails, and the parent
// simply stops being told anything — while ALSO no longer receiving the SMS
// that would have reached them. These tests exist because that failure has
// no symptom of its own.

const SCHOOL = "school-1";

const deleteMany = vi.fn(async (..._args: unknown[]) => ({ count: 1 }));
vi.mock("@school-kit/db", () => ({
  withTenant: (_schoolId: string, fn: (db: unknown) => unknown) =>
    fn({ deviceToken: { deleteMany: (...a: unknown[]) => deleteMany(...a) } }),
}));

function make(expo: { send?: unknown; getReceipts?: unknown }) {
  const add = vi.fn(async (..._args: unknown[]) => undefined);
  const service = new PushProcessor(
    { send: vi.fn(), getReceipts: vi.fn(), ...expo } as never,
    { add } as never,
  );
  return { service, add };
}

function job(name: string, data: unknown) {
  return { id: "j1", name, data } as never;
}

describe("PushProcessor", () => {
  beforeEach(() => {
    deleteMany.mockClear();
    deleteMany.mockResolvedValue({ count: 1 });
  });

  it("refuses a job with no schoolId rather than processing it", async () => {
    const { service } = make({});
    await expect(service.process(job(PUSH_JOB_SEND, { tokens: [] }))).rejects.toThrow(/schoolId/);
  });

  it("refuses an unknown job name", async () => {
    const { service } = make({});
    await expect(service.process(job("nonsense", { schoolId: SCHOOL }))).rejects.toThrow(
      /unknown job name/,
    );
  });

  it("schedules a receipt poll for accepted tickets, and does not prune them", async () => {
    // An "ok" ticket is an ACCEPTANCE, not a delivery. Pruning or trusting it
    // here would be the exact conflation D39 exists to prevent.
    const send = vi.fn(async () => [{ status: "ok", id: "ticket-1" }]);
    const { service, add } = make({ send });

    await service.process(
      job(PUSH_JOB_SEND, {
        schoolId: SCHOOL,
        tokens: ["ExponentPushToken[a]"],
        title: "School",
        body: "Something happened",
      }),
    );

    expect(deleteMany).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]?.[0]).toBe(PUSH_JOB_RECEIPTS);
    expect(add.mock.calls[0]?.[1]).toEqual({
      schoolId: SCHOOL,
      tickets: { "ticket-1": "ExponentPushToken[a]" },
    });
  });

  it("prunes immediately on a DeviceNotRegistered TICKET", async () => {
    const send = vi.fn(async () => [
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);
    const { service, add } = make({ send });

    await service.process(
      job(PUSH_JOB_SEND, {
        schoolId: SCHOOL,
        tokens: ["ExponentPushToken[gone]"],
        title: "School",
        body: "Something happened",
      }),
    );

    expect(deleteMany).toHaveBeenCalledWith({
      where: { expoPushToken: { in: ["ExponentPushToken[gone]"] } },
    });
    // Nothing to poll — every ticket was resolved at send time.
    expect(add).not.toHaveBeenCalled();
  });

  it("does NOT prune on a non-DeviceNotRegistered ticket error", async () => {
    // A transient Expo-side failure must not delete a working device: the
    // token cannot be recovered until the app happens to re-register, so an
    // over-eager prune costs a parent push access until they reopen the app.
    const send = vi.fn(async () => [
      { status: "error", details: { error: "MessageRateExceeded" } },
    ]);
    const { service } = make({ send });

    await service.process(
      job(PUSH_JOB_SEND, {
        schoolId: SCHOOL,
        tokens: ["ExponentPushToken[busy]"],
        title: "School",
        body: "Something happened",
      }),
    );

    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("maps tickets to tokens POSITIONALLY across a mixed batch", async () => {
    // Expo returns one ticket per message in input order. If that mapping
    // slipped, the wrong parent's device would be deleted — the failure is
    // silent and affects someone whose app is working perfectly.
    const send = vi.fn(async () => [
      { status: "ok", id: "t-0" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
      { status: "ok", id: "t-2" },
    ]);
    const { service, add } = make({ send });

    await service.process(
      job(PUSH_JOB_SEND, {
        schoolId: SCHOOL,
        tokens: ["ExponentPushToken[0]", "ExponentPushToken[1]", "ExponentPushToken[2]"],
        title: "School",
        body: "Something happened",
      }),
    );

    expect(deleteMany).toHaveBeenCalledWith({
      where: { expoPushToken: { in: ["ExponentPushToken[1]"] } },
    });
    expect(add.mock.calls[0]?.[1]).toEqual({
      schoolId: SCHOOL,
      tickets: { "t-0": "ExponentPushToken[0]", "t-2": "ExponentPushToken[2]" },
    });
  });

  it("prunes on a DeviceNotRegistered RECEIPT", async () => {
    const getReceipts = vi.fn(async () => ({
      "t-1": { status: "error", details: { error: "DeviceNotRegistered" } },
    }));
    const { service } = make({ getReceipts });

    await service.process(
      job(PUSH_JOB_RECEIPTS, {
        schoolId: SCHOOL,
        tickets: { "t-1": "ExponentPushToken[gone]" },
      }),
    );

    expect(deleteMany).toHaveBeenCalledWith({
      where: { expoPushToken: { in: ["ExponentPushToken[gone]"] } },
    });
  });

  it("re-polls an ABSENT receipt instead of treating it as delivered", async () => {
    // THE test of this file. Expo omits ids whose receipt is not ready yet.
    // Reading absence as success is how a dead token survives forever.
    const getReceipts = vi.fn(async () => ({}));
    const { service, add } = make({ getReceipts });

    await service.process(
      job(PUSH_JOB_RECEIPTS, {
        schoolId: SCHOOL,
        tickets: { "t-1": "ExponentPushToken[pending]" },
      }),
    );

    expect(deleteMany).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]?.[1]).toEqual({
      schoolId: SCHOOL,
      tickets: { "t-1": "ExponentPushToken[pending]" },
    });
  });

  it("re-polls ONLY the undecided remainder, not the whole batch", async () => {
    const getReceipts = vi.fn(async () => ({
      "t-1": { status: "ok" },
      "t-2": { status: "error", details: { error: "DeviceNotRegistered" } },
    }));
    const { service, add } = make({ getReceipts });

    await service.process(
      job(PUSH_JOB_RECEIPTS, {
        schoolId: SCHOOL,
        tickets: {
          "t-1": "ExponentPushToken[ok]",
          "t-2": "ExponentPushToken[gone]",
          "t-3": "ExponentPushToken[pending]",
        },
      }),
    );

    expect(deleteMany).toHaveBeenCalledWith({
      where: { expoPushToken: { in: ["ExponentPushToken[gone]"] } },
    });
    expect(add.mock.calls[0]?.[1]).toEqual({
      schoolId: SCHOOL,
      tickets: { "t-3": "ExponentPushToken[pending]" },
    });
  });

  it("does nothing further when every receipt is resolved", async () => {
    const getReceipts = vi.fn(async () => ({ "t-1": { status: "ok" } }));
    const { service, add } = make({ getReceipts });

    await service.process(
      job(PUSH_JOB_RECEIPTS, { schoolId: SCHOOL, tickets: { "t-1": "ExponentPushToken[ok]" } }),
    );

    expect(deleteMany).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });
});
