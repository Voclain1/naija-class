import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { QueryClient } from "@tanstack/react-query";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";
import { PERSIST_MAX_AGE_MS } from "./client";
import { mayPersistQuery } from "./persist-policy";

// Storage wiring for the offline cache. Separated from ./client.ts so the
// cache POLICY stays free of platform imports and therefore unit-testable;
// this file is the part that genuinely needs React Native.

const CACHE_KEY = "sk-query-cache";

export function createPersister() {
  return createAsyncStoragePersister({
    storage: AsyncStorage,
    key: CACHE_KEY,
    // Writing the whole cache on every mutation of it is wasteful on the
    // low-end Android hardware this app targets.
    throttleTime: 1000,
  });
}

/**
 * Persist options.
 *
 * Two exclusions here are security/correctness rules, not tuning:
 *
 *   shouldDehydrateMutation — belt to the mutations `networkMode: "always"`
 *   braces. Even if a mutation somehow ends up paused, refusing to write it
 *   to disk means it cannot survive an app restart and fire against a stale
 *   balance hours later. D9 is enforced in two independent places on purpose.
 *
 *   shouldDehydrateQuery — nothing whose key mentions auth/session/token is
 *   ever written to disk. The session token lives in expo-secure-store
 *   (encrypted, OS-managed); AsyncStorage is plaintext. This guards against a
 *   future query accidentally pulling a credential into the cache (D12).
 */
export const persistOptions: Omit<PersistQueryClientOptions, "queryClient"> = {
  persister: createPersister(),
  maxAge: PERSIST_MAX_AGE_MS,
  dehydrateOptions: {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery: (query) => {
      return query.state.status === "success" && mayPersistQuery(query.queryKey, query.meta);
    },
  },
};

/**
 * Wipe every trace of the previous user (D12).
 *
 * A shared family phone is the normal case here, not an edge case: one
 * handset, several children, possibly a parent account too. The next person
 * to sign in must not see the last one's cached results.
 *
 * Clearing the in-memory client alone is NOT enough — the persisted copy
 * would rehydrate on next launch. Both have to go, which is why this helper
 * exists rather than a bare `queryClient.clear()` at the logout call site.
 */
export async function wipeOfflineCache(queryClient: QueryClient): Promise<void> {
  queryClient.clear();
  await createPersister().removeClient();
}
