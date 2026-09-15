import { describe, expect, it } from "vitest";

import type {
  ClassArmDto,
  ClassLevelDto,
  SubjectDto,
  TeacherAssignmentDto,
  TermDto,
} from "@school-kit/types";

import {
  assignmentAppliesToTerm,
  defaultGradebookTerm,
  gradebookArms,
  gradebookSubjects,
} from "./admin-gradebook";

const NOW = "2026-09-15T00:00:00.000Z";

const term = (over: Partial<TermDto> = {}): TermDto => ({
  id: "t1",
  academicYearId: "y1",
  sequence: 1,
  name: "First Term",
  startDate: NOW,
  endDate: NOW,
  isCurrent: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const subject = (id: string, name: string, isActive = true): SubjectDto => ({
  id,
  name,
  code: id,
  category: "CORE",
  isActive,
  createdAt: NOW,
  updatedAt: NOW,
});

const assignment = (over: Partial<TeacherAssignmentDto> = {}): TeacherAssignmentDto => ({
  id: "as1",
  teacherId: "u1",
  classArmId: "arm1",
  subjectId: "eng",
  academicYearId: "y1",
  termId: null,
  isActive: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const arm = (id: string, name: string, classLevelId: string, isActive = true): ClassArmDto => ({
  id,
  classLevelId,
  name,
  code: id,
  capacity: null,
  classTeacherId: null,
  isActive,
  createdAt: NOW,
  updatedAt: NOW,
});

const level = (id: string, orderIndex: number): ClassLevelDto => ({
  id,
  name: id,
  code: id,
  stage: "JSS",
  orderIndex,
  isActive: true,
  createdAt: NOW,
  updatedAt: NOW,
});

describe("gradebookSubjects", () => {
  const subjects = [subject("math", "Mathematics"), subject("eng", "English"), subject("bio", "Biology")];

  it("lists every active subject when the school has no teachers or assignments at all", () => {
    const out = gradebookSubjects(subjects, [], "arm1", term());
    expect(out.map((s) => s.name)).toEqual(["Biology", "English", "Mathematics"]);
    expect(out.every((s) => !s.hasTeacher)).toBe(true);
  });

  it("puts subjects with an assigned teacher first, then the rest, alphabetical within each", () => {
    const out = gradebookSubjects(
      subjects,
      [assignment({ subjectId: "math" }), assignment({ id: "as2", subjectId: "eng" })],
      "arm1",
      term(),
    );
    expect(out.map((s) => [s.name, s.hasTeacher])).toEqual([
      ["English", true],
      ["Mathematics", true],
      ["Biology", false],
    ]);
  });

  it("omits inactive subjects", () => {
    const out = gradebookSubjects([...subjects, subject("old", "Agric", false)], [], "arm1", term());
    expect(out.some((s) => s.id === "old")).toBe(false);
  });

  it("ignores an assignment for a different class", () => {
    const out = gradebookSubjects(subjects, [assignment({ classArmId: "arm2" })], "arm1", term());
    expect(out.find((s) => s.id === "eng")!.hasTeacher).toBe(false);
  });

  it("ignores an assignment that does not apply to the term", () => {
    const out = gradebookSubjects(subjects, [assignment({ termId: "t2" })], "arm1", term());
    expect(out.find((s) => s.id === "eng")!.hasTeacher).toBe(false);
  });
});

describe("assignmentAppliesToTerm (D35)", () => {
  it("a whole-year assignment applies to a term of that year", () => {
    expect(assignmentAppliesToTerm(assignment(), term())).toBe(true);
  });
  it("a whole-year assignment does not apply to a term of another year", () => {
    expect(assignmentAppliesToTerm(assignment({ academicYearId: "y0" }), term())).toBe(false);
  });
  it("a term-specific assignment applies only to its own term", () => {
    expect(assignmentAppliesToTerm(assignment({ termId: "t1" }), term())).toBe(true);
    expect(assignmentAppliesToTerm(assignment({ termId: "t2" }), term())).toBe(false);
  });
  it("a term-specific assignment is not rescued by a matching year", () => {
    expect(assignmentAppliesToTerm(assignment({ termId: "t2", academicYearId: "y1" }), term())).toBe(false);
  });
  it("an inactive assignment never applies", () => {
    expect(assignmentAppliesToTerm(assignment({ isActive: false }), term())).toBe(false);
    expect(assignmentAppliesToTerm(assignment({ isActive: false, termId: "t1" }), term())).toBe(false);
  });
});

describe("gradebookArms", () => {
  it("orders active classes by level order, then name, and drops inactive ones", () => {
    const out = gradebookArms(
      [
        arm("b", "JSS 2 B", "jss2"),
        arm("x", "JSS 1 Z", "jss1", false),
        arm("a", "JSS 2 A", "jss2"),
        arm("p", "Primary 6", "pry6"),
        arm("c", "JSS 1 A", "jss1"),
      ],
      [level("jss2", 8), level("jss1", 7), level("pry6", 6)],
    );
    expect(out.map((a) => a.name)).toEqual(["Primary 6", "JSS 1 A", "JSS 2 A", "JSS 2 B"]);
  });

  it("sorts a class whose level is unknown after every known level", () => {
    const out = gradebookArms([arm("u", "Annex", "missing"), arm("a", "JSS 1 A", "jss1")], [level("jss1", 7)]);
    expect(out.map((a) => a.name)).toEqual(["JSS 1 A", "Annex"]);
  });
});

describe("defaultGradebookTerm", () => {
  it("picks the current term even when it is not listed first", () => {
    expect(defaultGradebookTerm([term({ id: "t1", isCurrent: false }), term({ id: "t2", isCurrent: true })])!.id).toBe("t2");
  });
  it("falls back to the first term when none is current", () => {
    expect(defaultGradebookTerm([term({ id: "t1", isCurrent: false }), term({ id: "t2", isCurrent: false })])!.id).toBe("t1");
  });
  it("is null with no terms", () => {
    expect(defaultGradebookTerm([])).toBeNull();
  });
});
