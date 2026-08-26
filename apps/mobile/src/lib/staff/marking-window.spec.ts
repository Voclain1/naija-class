import { afterEach, describe, expect, it, vi } from "vitest";

import { markingBlockMessage, markingWindow } from "./marking-window";
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

describe("marking window (CP2 temporary rail)", () => {
  it("allows the server's today", () => {
    expect(markingWindow("2026-08-25", "2026-08-25")).toEqual({ canMark: true, reason: null });
  });

  it("blocks yesterday — the back-dating case the rail exists for", () => {
    expect(markingWindow("2026-08-24", "2026-08-25")).toEqual({
      canMark: false,
      reason: "NOT_TODAY",
    });
  });

  it("blocks tomorrow too, even though the server would also reject it", () => {
    // Defence in depth, not duplication: resolveTermForDate throws on a future
    // date server-side. The rail should not be the only thing standing there,
    // and the server should not be the first thing to notice.
    expect(markingWindow("2026-08-26", "2026-08-25").canMark).toBe(false);
  });

  it("blocks when the server clock is unknown rather than trusting the device", () => {
    expect(markingWindow("2026-08-25", null)).toEqual({
      canMark: false,
      reason: "NO_SERVER_CLOCK",
    });
  });

  it("says 'for now' out loud, so the rail does not read as a designed rule", () => {
    expect(markingBlockMessage("NOT_TODAY")).toContain("For now");
    expect(markingBlockMessage("NOT_TODAY")).toContain("web teacher portal");
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
