import { describe, expect, it, vi } from "vitest";

import {
  VendorApiError,
  classifyVendorError,
  computeBackoffMs,
  parseRetryAfterMs,
  retryWithBackoff,
} from "@school-kit/ai";

// Phase 7 / CP2 — retry and backoff (D4a consequence 2).
//
// The rule under test is the one D4a states plainly: "A 429 must be a retry,
// not a FAILED document."
//
// These specs use an INJECTED sleep, so they assert the policy — how many
// attempts, how long each wait, which errors are retried at all — without
// spending wall-clock time. The complementary live evidence (that the real
// vendor's 429 carries the status this classifier keys on) came from the
// observed rate limit on 2026-09-02, recorded in phase-7.md D4a.

const rateLimited = (retryAfterMs: number | null = null) =>
  new VendorApiError("Voyage embeddings request failed: 429 Too Many Requests", 429, retryAfterMs);

describe("classifyVendorError", () => {
  it("classifies 429 as rate-limit", () => {
    expect(classifyVendorError(rateLimited())).toBe("rate-limit");
  });

  it("classifies 5xx and 408 as transient", () => {
    expect(classifyVendorError(new VendorApiError("boom", 500))).toBe("transient");
    expect(classifyVendorError(new VendorApiError("boom", 503))).toBe("transient");
    expect(classifyVendorError(new VendorApiError("boom", 408))).toBe("transient");
  });

  it("classifies a client-side network fault as transient", () => {
    // Found empirically on 2026-09-02: at ~2500 req/min the LOCAL machine ran
    // out of sockets and 208 of 500 calls threw a bare `fetch failed` — a
    // client-side transient, not a vendor refusal. In a long ingestion run this
    // class of error is more likely than a 429, so it must be retried too.
    expect(classifyVendorError(new TypeError("fetch failed"))).toBe("transient");
    expect(classifyVendorError(new Error("socket hang up"))).toBe("transient");
    expect(classifyVendorError(new Error("ECONNRESET"))).toBe("transient");
  });

  it("classifies a bad key as FATAL, so it is never retried", () => {
    expect(classifyVendorError(new VendorApiError("unauthorized", 401))).toBe("fatal");
    expect(classifyVendorError(new VendorApiError("bad request", 400))).toBe("fatal");
  });
});

describe("retryWithBackoff", () => {
  it("RETRIES a 429 and ultimately succeeds — the D4a rule", () => {
    return (async () => {
      let calls = 0;
      const sleep = vi.fn(async () => undefined);

      const result = await retryWithBackoff(
        async () => {
          calls += 1;
          if (calls < 3) throw rateLimited();
          return "embedded";
        },
        { sleep, random: () => 1, maxAttempts: 5 },
      );

      expect(result).toBe("embedded");
      expect(calls).toBe(3);
      expect(sleep).toHaveBeenCalledTimes(2);
    })();
  });

  it("does NOT retry a fatal error, and does not sleep", async () => {
    const sleep = vi.fn(async () => undefined);
    let calls = 0;

    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new VendorApiError("unauthorized", 401);
        },
        { sleep, maxAttempts: 5 },
      ),
    ).rejects.toThrow(/unauthorized/);

    // Burning five attempts on a bad API key only delays a clear error.
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after maxAttempts and rethrows the LAST error", async () => {
    const sleep = vi.fn(async () => undefined);
    let calls = 0;

    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw rateLimited();
        },
        { sleep, maxAttempts: 3, random: () => 1 },
      ),
    ).rejects.toThrow(/429/);

    expect(calls).toBe(3);
    // Two waits for three attempts — never a wait after the final failure.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("BACKS OFF EXPONENTIALLY between attempts", async () => {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms);
    });

    await expect(
      retryWithBackoff(async () => Promise.reject(rateLimited()), {
        sleep,
        maxAttempts: 5,
        baseDelayMs: 1000,
        // random() === 1 makes full jitter deterministic at its ceiling, so the
        // exponential shape is assertable.
        random: () => 1,
      }),
    ).rejects.toThrow();

    expect(delays).toEqual([1000, 2000, 4000, 8000]);
  });

  it("HONOURS Retry-After over its own exponential guess", async () => {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms);
    });

    let calls = 0;
    await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls === 1) throw rateLimited(21_000);
        return "ok";
      },
      { sleep, random: () => 1, baseDelayMs: 1000 },
    );

    // The vendor's own statement of when the limit clears beats guessing
    // shorter, which would just burn an attempt.
    expect(delays).toEqual([21_000]);
  });

  it("caps the delay so a job cannot wait indefinitely", () => {
    expect(computeBackoffMs(20, { baseDelayMs: 1000, maxDelayMs: 60_000, random: () => 1 })).toBe(
      60_000,
    );
    expect(computeBackoffMs(1, { maxDelayMs: 5_000 }, 999_999)).toBe(5_000);
  });

  it("applies JITTER, so parallel retries do not re-collide in lockstep", () => {
    const a = computeBackoffMs(3, { baseDelayMs: 1000, random: () => 0.1 });
    const b = computeBackoffMs(3, { baseDelayMs: 1000, random: () => 0.9 });
    expect(a).not.toBe(b);
    expect(a).toBeLessThan(b);
  });
});

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfterMs("21")).toBe(21_000);
    expect(parseRetryAfterMs(" 0 ")).toBe(0);
  });

  it("parses an HTTP-date", () => {
    const future = new Date(Date.now() + 30_000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).toBeGreaterThan(20_000);
    expect(ms).toBeLessThanOrEqual(31_000);
  });

  it("returns null for absent or unparseable values", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("soon")).toBeNull();
  });
});
