import { afterEach, describe, expect, it } from "vitest";

import { STASH_MAX_AGE_MS, decodeStash, encodeStash, ownerOfKey, splitChunks, type DraftEntry } from "./draft-stash";
import {
  clearAllGradebookDrafts,
  draftKey,
  exportAllDrafts,
  importDrafts,
  lessonPlanDraftKey,
  readDraft,
  setDraftCell,
} from "./gradebook-drafts";

const ME = { schoolId: "school-a", userId: "teacher-1" };
const SCOPE = { ...ME, termId: "t1", classArmId: "arm-1", subjectId: "maths" };
const NOW = Date.UTC(2026, 9, 14, 9, 0, 0);

const marks: DraftEntry = [draftKey(SCOPE, "ca1"), { s1: "14", s2: "9" }];
const note: DraftEntry = [lessonPlanDraftKey({ ...ME, lessonPlanId: "plan-1" }), { intro: "Fractions are parts of a whole." }];
const someoneElse: DraftEntry = [draftKey({ ...SCOPE, userId: "teacher-2" }, "ca1"), { s1: "3" }];
const otherSchool: DraftEntry = [draftKey({ ...SCOPE, schoolId: "school-b" }, "ca1"), { s1: "7" }];

afterEach(() => clearAllGradebookDrafts());

describe("whose draft a key is", () => {
  it("reads the school and user every draft key starts with", () => {
    expect(ownerOfKey(marks[0])).toEqual(ME);
    expect(ownerOfKey(note[0])).toEqual(ME);
    expect(ownerOfKey("not a key")).toBeNull();
    expect(ownerOfKey('{"x":1}|score:a')).toBeNull();
  });
});

describe("the forced-sign-out stash", () => {
  it("gives the same person back their marks and lesson-note text", () => {
    const raw = encodeStash([marks, note], NOW);
    expect(decodeStash(raw, ME, NOW + 60_000)).toEqual([marks, note]);
  });

  it("gives nothing of theirs to another teacher, or to the same id at another school", () => {
    const raw = encodeStash([marks, someoneElse, otherSchool], NOW);
    expect(decodeStash(raw, { schoolId: "school-a", userId: "teacher-2" }, NOW)).toEqual([someoneElse]);
    expect(decodeStash(raw, ME, NOW)).toEqual([marks]);
  });

  it("expires after a week", () => {
    const raw = encodeStash([marks], NOW);
    expect(decodeStash(raw, ME, NOW + STASH_MAX_AGE_MS)).toEqual([marks]);
    expect(decodeStash(raw, ME, NOW + STASH_MAX_AGE_MS + 1)).toEqual([]);
  });

  it("writes nothing when there is nothing typed", () => {
    expect(encodeStash([], NOW)).toBeNull();
    expect(encodeStash([[draftKey(SCOPE, "ca1"), { s1: "" }]], NOW)).toBeNull();
  });

  it("reads anything damaged as empty", () => {
    expect(decodeStash(null, ME, NOW)).toEqual([]);
    expect(decodeStash("{", ME, NOW)).toEqual([]);
    expect(decodeStash(JSON.stringify({ v: 99, savedAt: NOW, entries: [marks] }), ME, NOW)).toEqual([]);
    expect(decodeStash(JSON.stringify({ v: 1, savedAt: NOW, entries: [["x", "y"], marks] }), ME, NOW)).toEqual([marks]);
  });

  it("splits a long note into pieces that join back exactly", () => {
    const long = "é".repeat(20_001);
    const chunks = splitChunks(long, 8000);
    expect(chunks).toHaveLength(3);
    expect(chunks.join("")).toBe(long);
  });
});

describe("the draft store's export and import", () => {
  it("round-trips through export, clear and import", () => {
    setDraftCell(marks[0], "s1", "14");
    setDraftCell(marks[0], "s2", "9");
    const exported = exportAllDrafts();
    clearAllGradebookDrafts();
    expect(readDraft(marks[0])).toEqual({});
    importDrafts(exported);
    expect(readDraft(marks[0])).toEqual({ s1: "14", s2: "9" });
  });

  it("exports a copy the caller cannot use to change the store", () => {
    setDraftCell(marks[0], "s1", "14");
    exportAllDrafts()[0]![1].s1 = "99";
    expect(readDraft(marks[0])).toEqual({ s1: "14" });
  });
});
