import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GradebookFormValues } from "@/components/teacher/gradebook/gradebook-form";

import {
  changedCells,
  clearAllScoreDrafts,
  clearScoreDraft,
  readScoreDraft,
  restorableCells,
  SCORE_DRAFT_MAX_AGE_MS,
  writeScoreDraft,
} from "./score-draft";

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

const scope = { userId: "u1", termId: "t1", classArmId: "a1", subjectId: "s1" };

function grid(...rows: [string, Record<string, string>][]): GradebookFormValues {
  return { rows: rows.map(([studentId, scores]) => ({ studentId, scores })) };
}

describe("gradebook draft: unsaved marks survive a forced sign-out", () => {
  const loaded = grid(["st1", { ca: "10", exam: "" }], ["st2", { ca: "", exam: "" }]);

  it("keeps only the cells typed since the column loaded, never blanks", () => {
    const typed = grid(["st1", { ca: "10", exam: "55" }], ["st2", { ca: "", exam: "" }]);
    expect(changedCells(typed, loaded)).toEqual([{ studentId: "st1", componentId: "exam", value: "55" }]);

    const cleared = grid(["st1", { ca: "", exam: "" }], ["st2", { ca: "", exam: "" }]);
    expect(changedCells(cleared, loaded)).toEqual([]);
  });

  it("round-trips a draft for the same teacher and column, and nobody else's", () => {
    writeScoreDraft(scope, [{ studentId: "st2", componentId: "ca", value: "12" }], {});
    expect(readScoreDraft(scope)?.cells).toEqual([{ studentId: "st2", componentId: "ca", value: "12" }]);
    expect(readScoreDraft({ ...scope, userId: "u2" })).toBeNull();
    expect(readScoreDraft({ ...scope, subjectId: "s2" })).toBeNull();
  });

  it("removes the draft once nothing is unsaved (a save re-seeds the form)", () => {
    writeScoreDraft(scope, [{ studentId: "st2", componentId: "ca", value: "12" }], {});
    writeScoreDraft(scope, [], {});
    expect(readScoreDraft(scope)).toBeNull();
  });

  it("drops a draft older than the limit", () => {
    writeScoreDraft(scope, [{ studentId: "st2", componentId: "ca", value: "12" }], {}, 0);
    expect(readScoreDraft(scope, SCORE_DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(store.length).toBe(0);
  });

  it("stores ids and typed values only — no names", () => {
    writeScoreDraft(scope, [{ studentId: "st2", componentId: "ca", value: "12" }], { ca: 40 });
    const raw = store.getItem(store.key(0)!)!;
    expect(JSON.parse(raw)).toEqual({
      v: 1,
      savedAt: expect.any(Number),
      outOf: { ca: 40 },
      cells: [{ studentId: "st2", componentId: "ca", value: "12" }],
    });
  });

  it("a deliberate sign-out clears every teacher's drafts, and only drafts", () => {
    store.setItem("sk_import_upload_x", "{}");
    writeScoreDraft(scope, [{ studentId: "st2", componentId: "ca", value: "12" }], {});
    writeScoreDraft({ ...scope, subjectId: "s2" }, [{ studentId: "st2", componentId: "ca", value: "7" }], {});
    clearAllScoreDrafts();
    expect(store.length).toBe(1);
    expect(store.getItem("sk_import_upload_x")).toBe("{}");
  });

  it("clearScoreDraft removes just that column", () => {
    writeScoreDraft(scope, [{ studentId: "st2", componentId: "ca", value: "12" }], {});
    clearScoreDraft(scope);
    expect(readScoreDraft(scope)).toBeNull();
  });

  it("restores a cell only for a student still in the column, in the same units", () => {
    writeScoreDraft(
      scope,
      [
        { studentId: "st1", componentId: "exam", value: "40" },
        { studentId: "gone", componentId: "ca", value: "5" },
        { studentId: "st2", componentId: "ca", value: "30" },
        { studentId: "st2", componentId: "removed", value: "3" },
      ],
      { exam: 60 },
    );
    const draft = readScoreDraft(scope)!;

    const same = restorableCells(draft, loaded, { exam: 60 });
    expect(same.cells).toEqual([
      { studentId: "st1", componentId: "exam", value: "40", rowIndex: 0 },
      { studentId: "st2", componentId: "ca", value: "30", rowIndex: 1 },
    ]);
    expect(same.skipped).toBe(2);

    // The exam column is now entered out of 100: a mark typed out of 60 would
    // land in the wrong units, so it stays out.
    const changed = restorableCells(draft, loaded, { exam: 100 });
    expect(changed.cells.map((c) => c.componentId)).toEqual(["ca"]);
    expect(changed.skipped).toBe(3);
  });

  it("does nothing without browser storage", () => {
    delete g.window;
    expect(() => writeScoreDraft(scope, [{ studentId: "a", componentId: "b", value: "1" }], {})).not.toThrow();
    expect(readScoreDraft(scope)).toBeNull();
  });
});
