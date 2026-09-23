import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationDispatchService } from "./notification-dispatch.service";
import { PUSH_JOB_SEND } from "../../common/queue";

// Event notifications (docs/modules/notifications-v1.md N1, N4, N5, N6).
//
// The rules that cost real money or real trust when broken:
//   N4 — nothing added in v1 may reach SMS;
//   N5 — nothing non-urgent is delivered in the middle of the night;
//   N6 — one notification per person per event, however many times a caller
//        asks and however many children they have.
//
// withTenant is mocked because these are about the DECISION. The tenant
// boundary for device_tokens and notification_deliveries is enforced by RLS
// and exercised against real Postgres in the migration's own verification.

const SCHOOL = "school-1";

let tokens: { expoPushToken: string }[] = [];
let claimed: string[] = [];

const deviceToken = { findMany: vi.fn(async () => tokens) };
const notificationDelivery = {
  create: vi.fn(async ({ data }: { data: Record<string, string> }) => {
    const key = [data.eventType, data.eventId, data.principalType, data.principalId].join("|");
    // Stands in for the unique index: the second claim for one person is
    // refused, which is what makes "once" true (N6).
    if (claimed.includes(key)) throw new Error("unique violation");
    claimed.push(key);
    return { id: `d-${claimed.length}` };
  }),
  updateMany: vi.fn(async () => ({ count: 1 })),
};

vi.mock("@school-kit/db", () => ({
  withTenant: (_schoolId: string, fn: (db: unknown) => unknown) => fn({ deviceToken, notificationDelivery }),
}));

function make(channels = { email: true, sms: true, push: true }) {
  const add = vi.fn(async (..._args: unknown[]) => undefined);
  const service = new NotificationDispatchService(
    { add } as never,
    { getEnabledChannels: vi.fn(async () => channels) } as never,
  );
  return { service, add };
}

const event = (overrides: Record<string, unknown> = {}) =>
  ({
    schoolId: SCHOOL,
    principal: { type: "GUARDIAN", guardianId: "guardian-1" },
    eventType: "results.released",
    eventId: "term-1:arm-1",
    title: "Bright Star Academy",
    body: "Results have been released. Open the app to see them.",
    ...overrides,
  }) as Parameters<NotificationDispatchService["notifyOfEvent"]>[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  tokens = [{ expoPushToken: "ExponentPushToken[abc]" }];
  claimed = [];
});

describe("N6 — one notification per person per event", () => {
  it("sends the first time and refuses every repeat", async () => {
    const { service, add } = make();
    await expect(service.notifyOfEvent(event())).resolves.toBe("PUSH");
    await expect(service.notifyOfEvent(event())).resolves.toBe("NONE");
    await expect(service.notifyOfEvent(event())).resolves.toBe("NONE");
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("still tells a DIFFERENT person about the same event", async () => {
    const { service, add } = make();
    await service.notifyOfEvent(event());
    await service.notifyOfEvent(event({ principal: { type: "GUARDIAN", guardianId: "guardian-2" } }));
    expect(add).toHaveBeenCalledTimes(2);
  });

  it("treats the same person and a different event as a different thing", async () => {
    const { service, add } = make();
    await service.notifyOfEvent(event());
    await service.notifyOfEvent(event({ eventType: "payment.recorded", eventId: "pay-1" }));
    expect(add).toHaveBeenCalledTimes(2);
  });
});

describe("N4 — nothing here may ever reach SMS", () => {
  it("does not fall back to SMS when push is unavailable; it says nobody was reached", async () => {
    tokens = [];
    const { service, add } = make({ email: true, sms: true, push: true });
    await expect(service.notifyOfEvent(event())).resolves.toBe("NONE");
    expect(add).not.toHaveBeenCalled();
  });

  it("does not send when the school has push switched off, whatever SMS says", async () => {
    const { service, add } = make({ email: true, sms: true, push: false });
    await expect(service.notifyOfEvent(event())).resolves.toBe("NONE");
    expect(add).not.toHaveBeenCalled();
  });
});

describe("N5 — quiet hours hold, they do not drop", () => {
  it("delays a notification raised at 23:30 Lagos until 06:00", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T22:30:00Z")); // 23:30 Lagos
    const { service, add } = make();
    await service.notifyOfEvent(event());
    const [, , options] = add.mock.calls[0] as [string, unknown, { delay?: number }];
    expect(options.delay).toBe(6.5 * 3_600_000);
  });

  it("sends immediately during the day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T10:00:00Z")); // 11:00 Lagos
    const { service, add } = make();
    await service.notifyOfEvent(event());
    const [name, , options] = add.mock.calls[0] as [string, unknown, { delay?: number }];
    expect(name).toBe(PUSH_JOB_SEND);
    expect(options.delay).toBeUndefined();
  });
});

describe("N2/N3 — every principal, and nothing private on a lock screen", () => {
  it("reaches a student and a staff member by their own id", async () => {
    const { service } = make();
    await expect(
      service.notifyOfEvent(event({ principal: { type: "STUDENT", studentId: "student-1" } })),
    ).resolves.toBe("PUSH");
    expect(deviceToken.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { studentId: "student-1" } }),
    );
    await expect(
      service.notifyOfEvent(event({ principal: { type: "STAFF", userId: "user-1" } })),
    ).resolves.toBe("PUSH");
    expect(deviceToken.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } }),
    );
  });

  it("puts only the school's name and what happened into the push itself", async () => {
    const { service, add } = make();
    await service.notifyOfEvent(event());
    const [, data] = add.mock.calls[0] as [string, { title: string; body: string }];
    expect(data.title).toBe("Bright Star Academy");
    expect(data.body).toBe("Results have been released. Open the app to see them.");
    // No name, no grade, no amount — a lock screen is public.
    expect(`${data.title} ${data.body}`).not.toMatch(/₦|\d{2,}%|guardian-1/);
  });
});
