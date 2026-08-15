import { describe, expect, it } from "vitest";
import { GC_TIME_MS, PERSIST_MAX_AGE_MS, createQueryClient } from "./client";

// These assertions look like they are testing a third-party library's config.
// They are not — they lock in phase-6.md's D9/D10/D11 decisions, each of which
// is expressed as a single option value whose WRONG setting is the library
// DEFAULT. A silent revert here would not fail anything else in the suite, and
// the symptom in production would be a payment firing hours after the user
// tapped a button.

describe("query defaults — D9: online-only writes", () => {
  it('sets mutation networkMode to "always" so writes never queue offline', () => {
    // TanStack's default is "online", which PAUSES an offline mutation and
    // replays it on reconnect. That is an offline write queue. For a guardian
    // payment it means: tap Pay with no signal, believe fees are settled, and
    // the real Paystack call fires later against a balance that may have
    // changed. There is no acceptable UX for that failure, so writes must
    // fail immediately instead.
    const defaults = createQueryClient().getDefaultOptions();
    expect(defaults.mutations?.networkMode).toBe("always");
  });

  it("never retries a mutation", () => {
    // A retried money-mutating request is a duplicate payment attempt.
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(0);
  });
});

describe("query defaults — D10/D11: offline reads", () => {
  it('reads are "offlineFirst" rather than paused when believed offline', () => {
    // Network detection is wrong often enough (captive portals, flaky NetInfo
    // on some Android OEMs) that refusing to even attempt a fetch is worse
    // than attempting and failing.
    const defaults = createQueryClient().getDefaultOptions();
    expect(defaults.queries?.networkMode).toBe("offlineFirst");
  });

  it("keeps cached data at least as long as the persister will restore it", () => {
    // If gcTime < maxAge, the in-memory cache evicts entries the persister
    // would still have restored, and a cold start silently shows LESS data
    // than a warm one — a bug that only reproduces after an app restart.
    expect(GC_TIME_MS).toBeGreaterThanOrEqual(PERSIST_MAX_AGE_MS);
  });
});

describe("query defaults — data cost", () => {
  it("does no background polling and no refetch on focus", () => {
    // Prepaid data bundles: every automatic refetch is money the user spent
    // without asking. Reconnect is the one automatic refetch we keep, because
    // it is a real signal that fresh data just became cheaply available.
    const defaults = createQueryClient().getDefaultOptions();
    expect(defaults.queries?.refetchInterval).toBe(false);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.queries?.refetchOnReconnect).toBe(true);
  });

  it("does not retry a request the server already rejected with a 4xx", () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry;
    expect(typeof retry).toBe("function");
    const shouldRetry = retry as (n: number, e: unknown) => boolean;

    // A 404 or 403 will not become a 200 by asking again.
    expect(shouldRetry(0, { status: 404 })).toBe(false);
    expect(shouldRetry(0, { status: 403 })).toBe(false);
    // A 5xx or a transport failure might.
    expect(shouldRetry(0, { status: 503 })).toBe(true);
    expect(shouldRetry(0, new Error("network"))).toBe(true);
    // ...but not forever.
    expect(shouldRetry(2, new Error("network"))).toBe(false);
  });
});
