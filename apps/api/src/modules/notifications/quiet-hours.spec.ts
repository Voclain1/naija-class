import { describe, expect, it } from "vitest";

import { isQuietHour, lagosHour, quietHoursDelayMs } from "./quiet-hours";

// Quiet hours (docs/modules/notifications-v1.md N5). Nigeria is UTC+1 all
// year, so every case below states the Lagos time it means.

const at = (iso: string) => new Date(iso);

describe("what counts as the middle of the night", () => {
  it("reads the hour in Lagos, not the server's", () => {
    expect(lagosHour(at("2026-09-23T20:30:00Z"))).toBe(21);
    expect(lagosHour(at("2026-09-23T23:30:00Z"))).toBe(0);
  });

  it("is 21:00 up to 06:00, in the school's time", () => {
    expect(isQuietHour(at("2026-09-23T20:00:00Z"))).toBe(true); // 21:00 Lagos
    expect(isQuietHour(at("2026-09-23T23:59:00Z"))).toBe(true); // 00:59 Lagos
    expect(isQuietHour(at("2026-09-23T04:59:00Z"))).toBe(true); // 05:59 Lagos
    expect(isQuietHour(at("2026-09-23T05:00:00Z"))).toBe(false); // 06:00 Lagos
    expect(isQuietHour(at("2026-09-23T13:00:00Z"))).toBe(false); // 14:00 Lagos
    expect(isQuietHour(at("2026-09-23T19:59:00Z"))).toBe(false); // 20:59 Lagos
  });
});

describe("holding, not dropping", () => {
  it("sends immediately during the day", () => {
    expect(quietHoursDelayMs(at("2026-09-23T13:00:00Z"))).toBe(0);
  });

  it("holds a 22:00 notification until 06:00 the next morning — 8 hours", () => {
    expect(quietHoursDelayMs(at("2026-09-23T21:00:00Z"))).toBe(8 * 3_600_000);
  });

  it("holds an early-hours one only until 06:00 the same morning", () => {
    // 05:59 Lagos → one minute.
    expect(quietHoursDelayMs(at("2026-09-23T04:59:00Z"))).toBe(60_000);
    // 00:30 Lagos → five and a half hours.
    expect(quietHoursDelayMs(at("2026-09-23T23:30:00Z"))).toBe(5.5 * 3_600_000);
  });

  it("never holds anything urgent — that is what the flag is for", () => {
    expect(quietHoursDelayMs(at("2026-09-23T23:30:00Z"), true)).toBe(0);
  });

  it("releases at 06:00 exactly, not 06:00-plus-a-drift", () => {
    const now = at("2026-09-23T22:17:42.123Z"); // 23:17:42.123 Lagos
    const release = new Date(now.getTime() + quietHoursDelayMs(now));
    expect(lagosHour(release)).toBe(6);
    expect(release.getUTCMinutes()).toBe(0);
    expect(release.getUTCSeconds()).toBe(0);
    expect(release.getUTCMilliseconds()).toBe(0);
  });
});
