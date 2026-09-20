import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearAllGradebookDrafts,
  clearDraft,
  clearDraftCells,
  columnHasDrafts,
  commentDraftKey,
  formCommentDraftKey,
  componentsWithDrafts,
  draftKey,
  hasCommentDrafts,
  readDraft,
  setDraftCell,
  subscribeGradebookDrafts,
  type DraftScope,
} from "./gradebook-drafts";

// CP6a Gate 4 — the D19 draft store.

const SCOPE: DraftScope = {
  schoolId: "school_a",
  userId: "user_a",
  termId: "term_1",
  classArmId: "arm_1",
  subjectId: "subject_1",
};

afterEach(() => clearAllGradebookDrafts());

describe("gradebook drafts", () => {
  it("keeps typed marks after the screen that typed them is gone", () => {
    // The lock unmounts the screen; the store is module state, so a remount
    // reading the same key sees the same cells.
    const key = draftKey(SCOPE, "ca1");
    setDraftCell(key, "student_1", "17");
    setDraftCell(key, "student_2", "9");
    expect(readDraft(draftKey({ ...SCOPE }, "ca1"))).toEqual({ student_1: "17", student_2: "9" });
  });

  it("returns a stable empty object for an unknown key", () => {
    // useSyncExternalStore requires a stable snapshot or it re-renders forever.
    expect(readDraft("nothing")).toBe(readDraft("nothing else"));
  });

  it("returns the same snapshot until something changes", () => {
    const key = draftKey(SCOPE, "ca1");
    setDraftCell(key, "student_1", "1");
    const first = readDraft(key);
    expect(readDraft(key)).toBe(first);
    setDraftCell(key, "student_1", "12");
    expect(readDraft(key)).not.toBe(first);
  });

  it("never lets another staff account read a draft", () => {
    setDraftCell(draftKey(SCOPE, "ca1"), "student_1", "17");
    expect(readDraft(draftKey({ ...SCOPE, userId: "user_b" }, "ca1"))).toEqual({});
    expect(readDraft(draftKey({ ...SCOPE, schoolId: "school_b" }, "ca1"))).toEqual({});
    expect(columnHasDrafts({ ...SCOPE, userId: "user_b" })).toBe(false);
  });

  it("does not confuse ids that concatenate to the same string", () => {
    const a = draftKey({ ...SCOPE, classArmId: "arm_1", subjectId: "x" }, "c");
    const b = draftKey({ ...SCOPE, classArmId: "arm_", subjectId: "1x" }, "c");
    expect(a).not.toBe(b);
  });

  it("clears saved cells and drops an emptied component", () => {
    const key = draftKey(SCOPE, "ca1");
    setDraftCell(key, "student_1", "17");
    setDraftCell(key, "student_2", "9");
    clearDraftCells(key, ["student_1"]);
    expect(readDraft(key)).toEqual({ student_2: "9" });
    clearDraftCells(key, ["student_2"]);
    expect(componentsWithDrafts(SCOPE)).toEqual([]);
  });

  it("lists which components of a column hold drafts", () => {
    setDraftCell(draftKey(SCOPE, "ca1"), "student_1", "17");
    setDraftCell(draftKey(SCOPE, "exam"), "student_1", "40");
    setDraftCell(draftKey({ ...SCOPE, subjectId: "other" }, "ca2"), "student_1", "3");
    expect(componentsWithDrafts(SCOPE).sort()).toEqual(["ca1", "exam"]);
    clearDraft(draftKey(SCOPE, "exam"));
    expect(componentsWithDrafts(SCOPE)).toEqual(["ca1"]);
  });

  it("keeps comment drafts apart from mark drafts (CP6b)", () => {
    setDraftCell(commentDraftKey(SCOPE), "student_1", "Works hard.");
    // A comment draft must not be counted as unsaved marks for a test…
    expect(componentsWithDrafts(SCOPE)).toEqual([]);
    // …but it is still unsaved work in the column.
    expect(hasCommentDrafts(SCOPE)).toBe(true);
    expect(columnHasDrafts(SCOPE)).toBe(true);
    expect(hasCommentDrafts({ ...SCOPE, userId: "user_b" })).toBe(false);
  });

  it("keeps the form teacher's overall comment apart from a column's drafts (CP7)", () => {
    const formKey = formCommentDraftKey({
      schoolId: SCOPE.schoolId,
      userId: SCOPE.userId,
      termId: SCOPE.termId,
      classArmId: SCOPE.classArmId,
    });
    setDraftCell(formKey, "student_1", "A steady term.");
    // The overall comment is about the whole term, not one subject, so it must
    // not count as unsaved work in any column — otherwise it would block a
    // subject sign-off it has nothing to do with.
    expect(componentsWithDrafts(SCOPE)).toEqual([]);
    expect(hasCommentDrafts(SCOPE)).toBe(false);
    expect(columnHasDrafts(SCOPE)).toBe(false);
    expect(readDraft(formKey)).toEqual({ student_1: "A steady term." });
    // Still principal-scoped like everything else in this store.
    expect(
      readDraft(
        formCommentDraftKey({
          schoolId: SCOPE.schoolId,
          userId: "user_b",
          termId: SCOPE.termId,
          classArmId: SCOPE.classArmId,
        }),
      ),
    ).toEqual({});
  });

  it("is wiped entirely at a principal boundary and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeGradebookDrafts(listener);
    setDraftCell(draftKey(SCOPE, "ca1"), "student_1", "17");
    clearAllGradebookDrafts();
    expect(columnHasDrafts(SCOPE)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setDraftCell(draftKey(SCOPE, "ca1"), "student_1", "1");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("never touches on-device storage (CP1: staff data is not persisted)", () => {
    const source = readFileSync(join(__dirname, "gradebook-drafts.ts"), "utf8");
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/async-storage|AsyncStorage|secure-store|SecureStore|expo-file-system/);
    expect(code).not.toMatch(/^import /m);
  });
});

describe("session wiring", () => {
  it("wipes drafts on session end and on staff sign-in, but not on lock", () => {
    const source = readFileSync(join(__dirname, "..", "auth", "session.tsx"), "utf8");
    const clearSession = source.slice(
      source.indexOf("const clearSession = useCallback"),
      source.indexOf("const consumeSessionEnd"),
    );
    const adoptStaff = source.slice(
      source.indexOf("const adoptStaffSession = useCallback"),
      source.indexOf("const signInStaff = useCallback"),
    );
    const lock = source.slice(
      source.indexOf("elapsed > 2 * 60 * 1000"),
      source.indexOf('setStatus("locked");', source.indexOf("elapsed > 2 * 60 * 1000")),
    );
    expect(clearSession).toContain("clearAllGradebookDrafts()");
    expect(adoptStaff).toContain("clearAllGradebookDrafts()");
    expect(lock.length).toBeGreaterThan(0);
    expect(lock).not.toContain("clearAllGradebookDrafts");
  });
});
