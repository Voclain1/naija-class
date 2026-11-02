import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearAllSessionDrafts,
  readSessionDraft,
  SESSION_DRAFT_MAX_AGE_MS,
  sessionDraftKey,
  writeSessionDraft,
} from "./session-draft";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

const g = globalThis as unknown as { window?: { sessionStorage: Storage } };
let store: Storage;
beforeEach(() => {
  store = memoryStorage();
  g.window = { sessionStorage: store };
});
afterEach(() => {
  delete g.window;
});

describe("session drafts: unsaved work survives a forced sign-out", () => {
  const key = sessionDraftKey("lesson-plan", "u1", "plan-1");

  it("round-trips for the same user and record only", () => {
    writeSessionDraft(key, { activities: "Step 1" });
    expect(readSessionDraft(key)?.data).toEqual({ activities: "Step 1" });
    expect(readSessionDraft(sessionDraftKey("lesson-plan", "u2", "plan-1"))).toBeNull();
    expect(readSessionDraft(sessionDraftKey("lesson-plan", "u1", "plan-2"))).toBeNull();
  });

  it("removes the draft when there is nothing unsaved", () => {
    writeSessionDraft(key, { activities: "Step 1" });
    writeSessionDraft(key, null);
    expect(store.length).toBe(0);
  });

  it("drops a draft older than the limit", () => {
    writeSessionDraft(key, { a: "b" }, 0);
    expect(readSessionDraft(key, SESSION_DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(store.length).toBe(0);
  });

  it("a deliberate sign-out clears every draft, and only drafts", () => {
    store.setItem("sk_gradebook_draft:x", "{}");
    writeSessionDraft(key, { a: "b" });
    writeSessionDraft(sessionDraftKey("class-subjects", "u1"), []);
    clearAllSessionDrafts();
    expect(store.length).toBe(1);
    expect(store.getItem("sk_gradebook_draft:x")).toBe("{}");
  });

  it("does nothing without browser storage", () => {
    delete g.window;
    expect(() => writeSessionDraft(key, { a: "b" })).not.toThrow();
    expect(readSessionDraft(key)).toBeNull();
  });
});
