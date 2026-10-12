import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { matrixDraftCells, restorableMatrixCells, toDesiredMap, type MatrixCellIntent } from "./matrix-draft";
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

describe("class-subject matrix draft", () => {
  // Saved now: JSS1 takes Maths (core); nothing else.
  const saved = (levelId: string, subjectId: string) =>
    levelId === "jss1" && subjectId === "maths" ? { isCore: true } : null;
  const desired = (entries: [string, string, MatrixCellIntent][]) => toDesiredMap(entries.map(([levelId, subjectId, intent]) => ({ levelId, subjectId, intent })));

  it("keeps only the toggles that change something", () => {
    const cells = matrixDraftCells(
      desired([
        ["jss1", "maths", { linked: true, isCore: true }], // same as saved: not kept
        ["jss1", "art", { linked: true, isCore: false }], // new link
        ["jss1", "music", { linked: false }], // unlinked and not linked: not kept
        ["jss2", "maths", { linked: true, isCore: true }], // new link
      ]),
      saved,
    );
    expect(cells.map((c) => `${c.levelId}/${c.subjectId}`)).toEqual(["jss1/art", "jss2/maths"]);
  });

  it("an unlink and a core/elective flip are both changes", () => {
    expect(matrixDraftCells(desired([["jss1", "maths", { linked: false }]]), saved)).toHaveLength(1);
    expect(matrixDraftCells(desired([["jss1", "maths", { linked: true, isCore: false }]]), saved)).toHaveLength(1);
  });

  it("restores only cells whose class level and subject still exist and still change something", () => {
    const cells = [
      { levelId: "jss1", subjectId: "art", intent: { linked: true, isCore: false } as MatrixCellIntent },
      { levelId: "gone", subjectId: "art", intent: { linked: true, isCore: false } as MatrixCellIntent },
      { levelId: "jss1", subjectId: "gone", intent: { linked: true, isCore: false } as MatrixCellIntent },
      { levelId: "jss1", subjectId: "maths", intent: { linked: true, isCore: true } as MatrixCellIntent },
    ];
    const back = restorableMatrixCells(cells, new Set(["jss1", "jss2"]), new Set(["art", "maths"]), saved);
    expect(back.map((c) => `${c.levelId}/${c.subjectId}`)).toEqual(["jss1/art"]);
  });
});
