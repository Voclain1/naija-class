import { afterEach, describe, expect, it, vi } from "vitest";

import {
  describeMarkingDate,
  markingBlockMessage,
  markingWindow,
  shiftIsoDate,
} from "./marking-window";
import {
  isoDateUtc,
  recordServerDate,
  resetServerClock,
  serverNowMs,
  serverToday,
} from "./server-date";

afterEach(() => {
  resetServerClock();
  vi.useRealTimers();
});

describe("marking window (D14 settled — parity with web)", () => {
  it("allows the server's today", () => {
    expect(markingWindow("2026-08-25", "2026-08-25")).toEqual({ canMark: true, reason: null });
  });

  it("ALLOWS yesterday — the case D14 was settled for", () => {
    // A teacher who forgot Friday's register has no laptop to correct it on.
    // CP2's rail blocked this on purpose while the policy was open; it is now
    // the behaviour web has always had.
    expect(markingWindow("2026-08-24", "2026-08-25")).toEqual({ canMark: true, reason: null });
  });

  it("allows a date far back in the term", () => {
    expect(markingWindow("2026-05-04", "2026-08-25").canMark).toBe(true);
  });

  it("blocks tomorrow, even though the server would also reject it", () => {
    // Defence in depth, not duplication: resolveTermForDate throws on a future
    // date server-side. The client should not be the only thing standing
    // there, and the server should not be the first thing to notice.
    expect(markingWindow("2026-08-26", "2026-08-25")).toEqual({
      canMark: false,
      reason: "FUTURE_DATE",
    });
  });

  it("blocks when the server clock is unknown rather than trusting the device", () => {
    expect(markingWindow("2026-08-25", null)).toEqual({
      canMark: false,
      reason: "NO_SERVER_CLOCK",
    });
  });

  it("explains a block in words a teacher can act on", () => {
    expect(markingBlockMessage("FUTURE_DATE")).toContain("hasn't happened yet");
    expect(markingBlockMessage("NO_SERVER_CLOCK")).toContain("Reload");
  });
});

describe("date navigation", () => {
  it("steps backwards and forwards in whole UTC days", () => {
    expect(shiftIsoDate("2026-08-25", -1)).toBe("2026-08-24");
    expect(shiftIsoDate("2026-08-25", 1)).toBe("2026-08-26");
  });

  it("crosses month and year boundaries", () => {
    expect(shiftIsoDate("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftIsoDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("names today and yesterday, so a back-dated register cannot pass for today's", () => {
    expect(describeMarkingDate("2026-08-25", "2026-08-25")).toBe("Today");
    expect(describeMarkingDate("2026-08-24", "2026-08-25")).toBe("Yesterday");
    expect(describeMarkingDate("2026-08-20", "2026-08-25")).toBe("2026-08-20");
    expect(describeMarkingDate("2026-08-20", null)).toBe("2026-08-20");
  });
});

describe("server clock", () => {
  it("is null until a response has been seen", () => {
    expect(serverNowMs()).toBeNull();
    expect(serverToday()).toBeNull();
  });

  it("derives today from the response Date header, not the device clock", () => {
    // Device clock is a year out. The server header must win outright.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T09:00:00.000Z"));
    recordServerDate("Tue, 25 Aug 2026 09:30:00 GMT");
    expect(serverToday()).toBe("2026-08-25");
  });

  it("advances the recorded server time by locally elapsed time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T23:59:00.000Z"));
    recordServerDate("Tue, 25 Aug 2026 23:59:00 GMT");
    expect(serverToday()).toBe("2026-08-25");
    // Two minutes pass on the device; the server date must roll over with it.
    vi.setSystemTime(new Date("2026-08-26T00:01:00.000Z"));
    expect(serverToday()).toBe("2026-08-26");
  });

  it("ignores a missing or unparseable header instead of poisoning the clock", () => {
    recordServerDate("Tue, 25 Aug 2026 09:30:00 GMT");
    const before = serverToday();
    recordServerDate(null);
    recordServerDate("not a date");
    expect(serverToday()).toBe(before);
  });

  it("formats a UTC instant as YYYY-MM-DD", () => {
    expect(isoDateUtc(Date.parse("2026-08-25T00:00:00.000Z"))).toBe("2026-08-25");
    expect(isoDateUtc(Date.parse("2026-08-25T23:59:59.999Z"))).toBe("2026-08-25");
  });
});
