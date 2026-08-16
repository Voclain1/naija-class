import { QueryClient } from "@tanstack/react-query";

// School Kit mobile — query cache POLICY. Implements phase-6.md D9-D11.
//
// The shape is: OFFLINE READS, ONLINE-ONLY WRITES.
//
// Read phase-6.md §7 for the full argument. The short version is that the
// write surface is almost entirely guardian payment initiation, and a payment
// queued offline has no acceptable failure case: the parent taps Pay with no
// signal, believes fees are settled, and the real Paystack transaction fires
// later against a balance that may have changed. CLAUDE.md's Money rules
// already forbid the frontend reasoning about balances at all.
//
// This module deliberately imports NOTHING platform-specific — no
// AsyncStorage, no react-native. That keeps the policy unit-testable under
// Vitest's node environment (see client.spec.ts), which matters because the
// most important rule here is enforced by a single config value that would
// otherwise be silently correct-by-default-until-it-isn't. Storage wiring
// lives in ./persist.ts.

/**
 * How long a persisted cache stays usable. 7 days is chosen against the
 * product's context rather than a default: a parent who opens the app once a
 * fortnight on patchy data should still see their child's last known results
 * and fee status instantly, rather than a spinner.
 */
export const PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

/**
 * gcTime must be >= the persister's maxAge, or the in-memory cache evicts
 * entries the persister would still have restored, and a cold start silently
 * shows less than a warm one.
 */
export const GC_TIME_MS = PERSIST_MAX_AGE_MS;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // "offlineFirst": serve cache immediately, still ATTEMPT the request
        // even when we believe we are offline. Deliberately not the default
        // "online", which pauses the fetch outright — network detection is
        // wrong often enough (captive portals, flaky NetInfo on some Android
        // OEMs) that refusing to try is worse than trying and failing.
        networkMode: "offlineFirst",

        gcTime: GC_TIME_MS,
        // A minute of "fresh" avoids a refetch storm when a user taps between
        // tabs, without making the data feel stale within a session.
        staleTime: 1000 * 60,

        // Data cost is a design input, not an afterthought: prepaid bundles
        // mean every refetch is money the user spent. No polling anywhere,
        // and no refetch merely because the app regained focus.
        refetchOnWindowFocus: false,
        refetchInterval: false,
        // Reconnecting IS a real signal that fresh data is cheaply available.
        refetchOnReconnect: true,

        // Two retries, not the default three, and never retry a request the
        // server has already answered with a 4xx — that is a wasted round
        // trip on a metered connection.
        retry: (failureCount, error) => {
          const status = (error as { status?: number }).status;
          if (typeof status === "number" && status >= 400 && status < 500) {
            return false;
          }
          return failureCount < 2;
        },
      },

      mutations: {
        // *** THE LOAD-BEARING LINE FOR D9 ***
        //
        // TanStack Query's DEFAULT mutation networkMode is "online", which
        // PAUSES a mutation fired while offline and replays it automatically
        // on reconnect. That is an offline write queue — precisely the thing
        // phase-6.md D9 rules out, and it would be switched on by default,
        // silently, with no code of ours involved.
        //
        // "always" makes a mutation fire regardless of believed network
        // state, so with no connection it fails immediately with an
        // ApiNetworkError the UI can show. Fail loudly now, never act later.
        networkMode: "always",
        // Money-adjacent writes must not be silently re-sent. A retry here is
        // a duplicate payment attempt, not a convenience.
        retry: 0,
      },
    },
  });
}
