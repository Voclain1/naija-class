import { beforeEach, describe, expect, it, vi } from "vitest";

import { ABSENCE_GRACE_MS, EVENT, EventNotifierService } from "./event-notifier.service";
import { NotificationDispatchService } from "./notification-dispatch.service";
import { PushProcessor } from "./push.processor";
import { PUSH_JOB_SEND } from "../../common/queue";

// Absence alerts (docs/modules/the-school-day.md Part A).
//
// A4 is what this spec mostly exists for. An absence told instantly cannot be
// recalled: the parent has read that their child is not in school and is
// already ringing. So the send is HELD, and re-read when the delay expires —
// and the hard part is that a correction inside the window must leave no
// alert behind AND must not silence a genuine absence later the same day.

const SCHOOL = "school-1";
const TODAY = "2026-09-28";

let links: { studentId: string; guardianId?: string }[] = [];
let absentCount = 0;
let claimed: string[] = [];
let deleted: Record<string, unknown>[] = [];

const school = { findUniqueOrThrow: vi.fn(async () => ({ name: "Bright Star Academy" })) };
const studentGuardian = { findMany: vi.fn(async () => links) };
const attendanceRecord = { count: vi.fn(async () => absentCount) };
const deviceToken = {
  findMany: vi.fn(async () => [{ expoPushToken: "ExponentPushToken[abc]" }]),
  deleteMany: vi.fn(async () => ({ count: 0 })),
};
const notificationDelivery = {
  create: vi.fn(async ({ data }: { data: Record<string, string> }) => {
    const key = [data.eventType, data.eventId, data.principalType, data.principalId].join("|");
    if (claimed.includes(key)) throw new Error("unique violation");
    claimed.push(key);
    return { id: `d-${claimed.length}` };
  }),
  updateMany: vi.fn(async () => ({ count: 1 })),
  deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    deleted.push(where);
    return { count: 1 };
  }),
};

vi.mock("@school-kit/db", () => ({
  withTenant: (_schoolId: string, fn: (db: unknown) => unknown) =>
    fn({ school, studentGuardian, attendanceRecord, deviceToken, notificationDelivery }),
}));

function notifier() {
  const add = vi.fn(async (..._args: unknown[]) => undefined);
  const dispatch = new NotificationDispatchService(
    { add } as never,
    { getEnabledChannels: vi.fn(async () => ({ email: true, sms: true, push: true })) } as never,
  );
  return { events: new EventNotifierService(dispatch, {} as never), add };
}

const jobOf = (add: ReturnType<typeof vi.fn>, call = 0) => add.mock.calls[call]?.[1] as Record<string, unknown>;
const optsOf = (add: ReturnType<typeof vi.fn>, call = 0) => add.mock.calls[call]?.[2] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  links = [{ studentId: "student-1", guardianId: "guardian-1" }];
  absentCount = 1;
  claimed = [];
  deleted = [];
});

describe("what a parent is told (A1, A3)", () => {
  it("names no child, and says only that one was marked absent", async () => {
    const { events, add } = notifier();
    await events.attendanceAbsent({
      schoolId: SCHOOL,
      date: TODAY,
      absentStudentIds: ["student-1"],
      today: TODAY,
    });

    const job = jobOf(add);
    expect(add.mock.calls[0]?.[0]).toBe(PUSH_JOB_SEND);
    expect(job.title).toBe("Bright Star Academy");
    // The lockscreen is the reason (N3): a phone face-up on a desk must not
    // announce which child is missing.
    expect(job.body).toBe("A child was marked absent today. Open the app to see.");
    expect(JSON.stringify(job)).not.toContain("student-1");
  });

  it("says nothing at all when nobody was absent", async () => {
    const { events, add } = notifier();
    await events.attendanceAbsent({ schoolId: SCHOOL, date: TODAY, absentStudentIds: [], today: TODAY });
    expect(add).not.toHaveBeenCalled();
  });
});

describe("A2 — one alert per guardian per day", () => {
  it("tells a parent of three absent children exactly once", async () => {
    links = [
      { studentId: "student-1", guardianId: "guardian-1" },
      { studentId: "student-2", guardianId: "guardian-1" },
      { studentId: "student-3", guardianId: "guardian-1" },
    ];
    const { events, add } = notifier();
    await events.attendanceAbsent({
      schoolId: SCHOOL,
      date: TODAY,
      absentStudentIds: ["student-1", "student-2", "student-3"],
      today: TODAY,
    });
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("does not tell them again when the register is re-submitted", async () => {
    const { events, add } = notifier();
    const args = {
      schoolId: SCHOOL,
      date: TODAY,
      absentStudentIds: ["student-1"],
      today: TODAY,
    };
    await events.attendanceAbsent(args);
    await events.attendanceAbsent(args);
    // The claim row is the whole mechanism (N6): the second submit is refused
    // by the unique index, not by anything remembering in process.
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("keys the event on the DATE, not the child, so the collapse can work", async () => {
    const { events } = notifier();
    await events.attendanceAbsent({
      schoolId: SCHOOL,
      date: TODAY,
      absentStudentIds: ["student-1"],
      today: TODAY,
    });
    expect(claimed).toEqual([`${EVENT.attendanceAbsent}|${TODAY}|GUARDIAN|guardian-1`]);
  });
});

describe("A4 — held for the grace period, then re-checked", () => {
  it("holds the send for the grace period rather than sending at once", async () => {
    const { events, add } = notifier();
    await events.attendanceAbsent({
      schoolId: SCHOOL,
      date: TODAY,
      absentStudentIds: ["student-1"],
      today: TODAY,
    });
    expect(optsOf(add).delay).toBe(ABSENCE_GRACE_MS);
  });

  it("carries what to re-read, so the job can check rather than trust the claim", async () => {
    const { events, add } = notifier();
    await events.attendanceAbsent({
      schoolId: SCHOOL,
      date: TODAY,
      absentStudentIds: ["student-1"],
      today: TODAY,
    });
    expect(jobOf(add).verify).toEqual({
      kind: "guardian-child-absent",
      guardianId: "guardian-1",
      date: TODAY,
    });
  });

  it("sends nothing when the register was corrected inside the window", async () => {
    const expo = { send: vi.fn(async () => []), getReceipts: vi.fn(async () => ({})) };
    const processor = new PushProcessor(expo as never, { add: vi.fn() } as never);
    absentCount = 0; // the teacher fixed it

    await processor.process({
      name: PUSH_JOB_SEND,
      data: {
        schoolId: SCHOOL,
        tokens: ["ExponentPushToken[abc]"],
        title: "Bright Star Academy",
        body: "A child was marked absent today. Open the app to see.",
        verify: { kind: "guardian-child-absent", guardianId: "guardian-1", date: TODAY },
      },
    } as never);

    expect(expo.send).not.toHaveBeenCalled();
  });

  it("releases the claim when it skips, so a real absence later that day still alerts", async () => {
    const expo = { send: vi.fn(async () => []), getReceipts: vi.fn(async () => ({})) };
    const processor = new PushProcessor(expo as never, { add: vi.fn() } as never);
    absentCount = 0;

    await processor.process({
      name: PUSH_JOB_SEND,
      data: {
        schoolId: SCHOOL,
        tokens: ["ExponentPushToken[abc]"],
        title: "Bright Star Academy",
        body: "A child was marked absent today. Open the app to see.",
        verify: { kind: "guardian-child-absent", guardianId: "guardian-1", date: TODAY },
      },
    } as never);

    // Without this, a typo at 08:00 would silence a genuine absence at 11:00.
    expect(deleted).toEqual([
      {
        eventType: EVENT.attendanceAbsent,
        eventId: TODAY,
        principalType: "GUARDIAN",
        principalId: "guardian-1",
      },
    ]);
  });

  it("still sends when the child is genuinely still absent", async () => {
    const expo = { send: vi.fn(async () => [{ status: "ok", id: "ticket-1" }]), getReceipts: vi.fn(async () => ({})) };
    const processor = new PushProcessor(expo as never, { add: vi.fn(async () => undefined) } as never);
    absentCount = 1;

    await processor.process({
      name: PUSH_JOB_SEND,
      data: {
        schoolId: SCHOOL,
        tokens: ["ExponentPushToken[abc]"],
        title: "Bright Star Academy",
        body: "A child was marked absent today. Open the app to see.",
        verify: { kind: "guardian-child-absent", guardianId: "guardian-1", date: TODAY },
      },
    } as never);

    expect(expo.send).toHaveBeenCalledTimes(1);
    expect(deleted).toEqual([]);
  });

  it("sends one of three corrected absences, because two are still absent", async () => {
    const expo = { send: vi.fn(async () => [{ status: "ok", id: "t" }]), getReceipts: vi.fn(async () => ({})) };
    const processor = new PushProcessor(expo as never, { add: vi.fn(async () => undefined) } as never);
    absentCount = 2;

    await processor.process({
      name: PUSH_JOB_SEND,
      data: {
        schoolId: SCHOOL,
        tokens: ["ExponentPushToken[abc]"],
        title: "Bright Star Academy",
        body: "A child was marked absent today. Open the app to see.",
        verify: { kind: "guardian-child-absent", guardianId: "guardian-1", date: TODAY },
      },
    } as never);

    expect(expo.send).toHaveBeenCalledTimes(1);
  });

  it("leaves every other push untouched — no verify, no extra read", async () => {
    const expo = { send: vi.fn(async () => [{ status: "ok", id: "t" }]), getReceipts: vi.fn(async () => ({})) };
    const processor = new PushProcessor(expo as never, { add: vi.fn(async () => undefined) } as never);

    await processor.process({
      name: PUSH_JOB_SEND,
      data: {
        schoolId: SCHOOL,
        tokens: ["ExponentPushToken[abc]"],
        title: "Bright Star Academy",
        body: "Results have been released. Open the app to see them.",
      },
    } as never);

    expect(expo.send).toHaveBeenCalledTimes(1);
    expect(attendanceRecord.count).not.toHaveBeenCalled();
  });
});

describe("a back-filled register stays silent", () => {
  it("says nothing about an absence dated before today", async () => {
    const { events, add } = notifier();
    // An admin entering last Tuesday's register is doing record-keeping. An
    // alert saying "today" about it would be worse than silence.
    await events.attendanceAbsent({
      schoolId: SCHOOL,
      date: "2026-09-22",
      absentStudentIds: ["student-1"],
      today: TODAY,
    });
    expect(add).not.toHaveBeenCalled();
    expect(claimed).toEqual([]);
  });
});
