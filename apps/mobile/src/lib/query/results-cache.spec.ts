import { describe, expect, it } from "vitest";

import { persistOptions } from "./persist";
import { queryKeys } from "./keys";

// Phase 6 / Slice 4 — D32.
//
// Released report cards are the best cache candidate in the app, and this
// file is what stops that claim from being merely an assertion in a comment.
//
// The reasoning: a RELEASED card is frozen server-side by released-guard.ts,
// so a cached copy cannot be WRONG — only absent. That is what justifies
// staleTime: Infinity on the detail screen, and what makes persisting these
// keys to disk worth doing for a parent standing outside a school with one
// bar of signal.
//
// The risk this file guards against is the opposite one: the persister's
// shouldDehydrateQuery filter excludes any key mentioning auth/session/token,
// and a future rename of these keys (say, "students" -> "student-sessions")
// would silently stop them persisting with no test going red anywhere.

function shouldPersist(
  key: readonly unknown[],
  status: "success" | "error" | "pending" = "success",
): boolean {
  const filter = persistOptions.dehydrateOptions?.shouldDehydrateQuery;
  if (!filter) throw new Error("shouldDehydrateQuery is not configured");
  // The filter inspects the serialised key AND the query status. Both are
  // supplied rather than stubbed loosely, because passing a key-only object
  // made every assertion below fail for a reason unrelated to what they test.
  return filter({ queryKey: key, state: { status } } as never);
}

describe("released results — offline cache (D32)", () => {
  it("persists the results LIST to disk", () => {
    expect(shouldPersist(queryKeys.results("student-1"))).toBe(true);
  });

  it("persists a single released card to disk", () => {
    expect(shouldPersist(queryKeys.result("student-1", "term-1"))).toBe(true);
  });

  it("keeps results keys clear of the auth/session/token exclusions", () => {
    // Stated explicitly because the exclusion is a SUBSTRING match on the
    // serialised key. It is not enough that today's keys pass; the words that
    // would break them should be named where someone renaming a key will see
    // them.
    for (const key of [
      queryKeys.results("s"),
      queryKeys.result("s", "t"),
    ]) {
      const serialised = JSON.stringify(key).toLowerCase();
      expect(serialised).not.toContain("auth");
      expect(serialised).not.toContain("session");
      expect(serialised).not.toContain("token");
    }
  });

  it("never persists a FAILED results fetch", () => {
    // Otherwise an error state would be written to disk and restored on the
    // next launch, so a parent who was briefly offline would be shown a
    // failure that has nothing to do with their current connection.
    expect(shouldPersist(queryKeys.results("student-1"), "error")).toBe(false);
    expect(shouldPersist(queryKeys.result("student-1", "term-1"), "pending")).toBe(
      false,
    );
  });

  it("scopes every results key by student id", () => {
    // Two children in one family must never share a cache entry. This is a
    // client-side echo of the server's rule that studentId is part of the
    // lookup rather than a filter applied afterwards.
    expect(queryKeys.results("child-a")).not.toEqual(queryKeys.results("child-b"));
    expect(queryKeys.result("child-a", "term-1")).not.toEqual(
      queryKeys.result("child-b", "term-1"),
    );
    expect(queryKeys.result("child-a", "term-1")).not.toEqual(
      queryKeys.result("child-a", "term-2"),
    );
  });

  it("nests a card under its student's results, so signing out clears both", () => {
    // queryClient.removeQueries({ queryKey: ["students"] }) on sign-out must
    // take the cards with it. A flat ["results", termId] key would survive
    // that sweep and leave one family's marks in another's cache after a
    // device hand-off.
    const list = queryKeys.results("child-a") as readonly unknown[];
    const detail = queryKeys.result("child-a", "term-1") as readonly unknown[];
    expect(detail.slice(0, list.length)).toEqual([...list]);
    expect(list[0]).toBe("students");
  });
});
