import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationDispatchService } from "./notification-dispatch.service";
import { PUSH_JOB_SEND } from "../../common/queue";

// Phase 6 / Slice 5 — the D37 exclusivity tests.
//
// These are the tests the slice exists for. The commercial argument for push
// is entirely "we stop paying Termii for messages push already delivered",
// and that saving is only real if push and SMS are mutually exclusive. A
// bug that sends both costs MORE than having no push at all, because it adds
// a second channel while paying for the first.
//
// The other half is worth as much: falling back to SMS when push is NOT
// available. Getting that wrong is silent — nobody is told, and nothing errors.

const SCHOOL = "school-1";
const GUARDIAN = "guardian-1";

// withTenant is mocked because these tests are about the DECISION, not about
// tenancy — the RLS boundary for device_tokens is exercised directly against
// Postgres in the migration's own verification, as app_user.
const findMany = vi.fn((..._args: unknown[]) => Promise.resolve([] as { expoPushToken: string }[]));
vi.mock("@school-kit/db", () => ({
  withTenant: (_schoolId: string, fn: (db: unknown) => unknown) =>
    fn({ deviceToken: { findMany: (...args: unknown[]) => findMany(...args) } }),
}));

function make(channels: { email: boolean; sms: boolean; push: boolean }) {
  const add = vi.fn(async (..._args: unknown[]) => undefined);
  const preferences = {
    getEnabledChannels: vi.fn(async () => channels),
  };
  const service = new NotificationDispatchService(
    { add } as never,
    preferences as never,
  );
  return { service, add, preferences };
}

function request(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schoolId: SCHOOL,
    guardianId: GUARDIAN,
    title: "Bright Star Academy",
    body: "A new invoice is available",
    smsAvailable: true,
    ...overrides,
  } as Parameters<NotificationDispatchService["notifyGuardian"]>[0];
}

describe("NotificationDispatchService.notifyGuardian", () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([]);
  });

  it("sends push and NOT sms when push is on and a token exists", async () => {
    findMany.mockResolvedValue([{ expoPushToken: "ExponentPushToken[a]" }]);
    const { service, add } = make({ email: true, sms: true, push: true });

    const channel = await service.notifyGuardian(request());

    // Both are asserted. "PUSH" alone would still pass if the caller were
    // also told to send an SMS by some other means.
    expect(channel).toBe("PUSH");
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]?.[0]).toBe(PUSH_JOB_SEND);
  });

  it("falls back to sms when the school has push OFF, even with a live token", async () => {
    // The token exists but the school has not opted in. Push being free is
    // not a reason to use a channel the school did not enable.
    findMany.mockResolvedValue([{ expoPushToken: "ExponentPushToken[a]" }]);
    const { service, add } = make({ email: true, sms: true, push: false });

    expect(await service.notifyGuardian(request())).toBe("SMS");
    expect(add).not.toHaveBeenCalled();
  });

  it("falls back to sms when push is on but NO token is registered", async () => {
    // The parent has not installed the app. This is the ordinary case for
    // most parents for a long time, and getting it wrong means silence.
    findMany.mockResolvedValue([]);
    const { service, add } = make({ email: true, sms: true, push: true });

    expect(await service.notifyGuardian(request())).toBe("SMS");
    expect(add).not.toHaveBeenCalled();
  });

  it("does not even look for tokens when push is off", async () => {
    // Cheap, but the point is behavioural: a disabled channel should cost no
    // query. It also proves the push check precedes the token read rather
    // than both running and the result being discarded.
    const { service } = make({ email: true, sms: true, push: false });

    await service.notifyGuardian(request());

    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns NONE when push is unavailable and sms is disabled", async () => {
    const { service, add } = make({ email: true, sms: false, push: false });

    expect(await service.notifyGuardian(request())).toBe("NONE");
    expect(add).not.toHaveBeenCalled();
  });

  it("returns NONE when sms is enabled but the caller has no sms to send", async () => {
    // e.g. the guardian has no phone number on file. Distinct from "sms
    // disabled" in cause, identical in outcome — nobody is reached.
    const { service } = make({ email: true, sms: true, push: false });

    expect(await service.notifyGuardian(request({ smsAvailable: false }))).toBe("NONE");
  });

  it("enqueues one job per Expo-sized batch", async () => {
    // 250 tokens on one guardian is not realistic; the batching path is what
    // a future school-wide fan-out reuses, and a limit discovered at 400
    // recipients is a limit discovered in production.
    findMany.mockResolvedValue(
      Array.from({ length: 250 }, (_, i) => ({ expoPushToken: `ExponentPushToken[${i}]` })),
    );
    const { service, add } = make({ email: true, sms: true, push: true });

    expect(await service.notifyGuardian(request())).toBe("PUSH");
    expect(add).toHaveBeenCalledTimes(3); // 100 + 100 + 50
  });

  it("puts only the lockscreen-safe body on the job (D36)", async () => {
    findMany.mockResolvedValue([{ expoPushToken: "ExponentPushToken[a]" }]);
    const { service, add } = make({ email: true, sms: true, push: true });

    await service.notifyGuardian(request());

    const payload = add.mock.calls[0]?.[1] as unknown as { title: string; body: string };
    expect(payload.body).toBe("A new invoice is available");
    // The request type has no field capable of carrying a name or an amount,
    // so this asserts the shape held rather than that a filter ran.
    expect(JSON.stringify(payload)).not.toMatch(/₦|\d{3,}/);
  });
});
