import { describe, expect, it } from "vitest";
import {
  STALE_AFTER_MS,
  describeFreshness,
  formatAsOf,
  isStale,
} from "./freshness";

const NOW = Date.UTC(2026, 7, 15, 12, 0, 0);
const seconds = (n: number) => n * 1000;
const minutes = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;
const days = (n: number) => n * 86_400_000;

describe("formatAsOf", () => {
  it.each([
    ["sub-minute", NOW - seconds(30), "just now"],
    ["one minute", NOW - minutes(1), "1 minute ago"],
    ["several minutes", NOW - minutes(42), "42 minutes ago"],
    ["one hour", NOW - hours(1), "1 hour ago"],
    ["several hours", NOW - hours(5), "5 hours ago"],
    ["one day", NOW - days(1), "yesterday"],
    ["several days", NOW - days(3), "3 days ago"],
  ])("%s -> %s", (_label, updatedAt, expected) => {
    expect(formatAsOf(updatedAt, NOW)).toBe(expected);
  });

  it("singularises 1 but not 2", () => {
    expect(formatAsOf(NOW - minutes(1), NOW)).toBe("1 minute ago");
    expect(formatAsOf(NOW - minutes(2), NOW)).toBe("2 minutes ago");
    expect(formatAsOf(NOW - hours(1), NOW)).toBe("1 hour ago");
    expect(formatAsOf(NOW - hours(2), NOW)).toBe("2 hours ago");
  });

  it("falls back to a calendar date beyond a week", () => {
    // Exact wording is locale-dependent, so assert it is NOT a relative
    // phrase rather than pinning a string the CI locale might not produce.
    const result = formatAsOf(NOW - days(30), NOW);
    expect(result).not.toContain("ago");
    expect(result).not.toBe("yesterday");
    expect(result.length).toBeGreaterThan(0);
  });

  it("reports a missing timestamp as 'never' rather than inventing one", () => {
    expect(formatAsOf(0, NOW)).toBe("never");
    expect(formatAsOf(Number.NaN, NOW)).toBe("never");
  });

  it("clamps a future timestamp to 'just now'", () => {
    // Device clock skew is common and real. Telling a user their fee balance
    // is "from -3 minutes ago" is worse than rounding to the present.
    expect(formatAsOf(NOW + minutes(3), NOW)).toBe("just now");
  });
});

describe("isStale", () => {
  it("is false just inside the threshold and true just outside", () => {
    expect(isStale(NOW - STALE_AFTER_MS + 1000, NOW)).toBe(false);
    expect(isStale(NOW - STALE_AFTER_MS - 1000, NOW)).toBe(true);
  });

  it("treats a missing timestamp as stale", () => {
    expect(isStale(0, NOW)).toBe(true);
  });
});

describe("describeFreshness", () => {
  it("leads with the offline fact when offline", () => {
    // Offline, the age of the data IS the story — the label must not read
    // like a routine status line.
    const { label, stale } = describeFreshness(NOW - minutes(10), {
      online: false,
      now: NOW,
    });
    expect(label).toBe("Offline — showing data from 10 minutes ago");
    expect(stale).toBe(true);
  });

  it("reads as routine when online and fresh", () => {
    const { label, stale } = describeFreshness(NOW - minutes(2), {
      online: true,
      now: NOW,
    });
    expect(label).toBe("Updated 2 minutes ago");
    expect(stale).toBe(false);
  });

  it("flags stale even when online", () => {
    const { label, stale } = describeFreshness(NOW - hours(12), {
      online: true,
      now: NOW,
    });
    expect(label).toBe("Updated 12 hours ago");
    expect(stale).toBe(true);
  });

  it("distinguishes 'loading' from 'no offline copy'", () => {
    // With no cached data at all, an offline user must be told there is
    // nothing to show — not left watching a spinner that cannot resolve.
    expect(describeFreshness(0, { online: true, now: NOW }).label).toBe(
      "Loading…",
    );
    expect(describeFreshness(0, { online: false, now: NOW }).label).toBe(
      "No offline copy available",
    );
  });
});
