import { describe, expect, it } from "vitest";

import { scanReviewStatsSchema, type ExtractedStudentRow, type ReviewedStudentRow } from "@school-kit/types";

import { scanReviewCounts } from "./scan-review-stats";

const read = (over: Partial<ExtractedStudentRow> = {}): ExtractedStudentRow => ({
  admissionNumber: "SKA/001",
  firstName: "Chiamaka",
  middleName: null,
  lastName: "Okonkwo",
  dateOfBirth: "2013-02-11",
  gender: "FEMALE",
  classArm: "JSS 1A",
  guardianName: null,
  guardianPhone: null,
  unreadableFields: [],
  ...over,
});

const saved = (rowNumber: number, over: Partial<ReviewedStudentRow> = {}): ReviewedStudentRow => ({
  rowNumber,
  admissionNumber: "SKA/001",
  firstName: "Chiamaka",
  lastName: "Okonkwo",
  dateOfBirth: "2013-02-11",
  gender: "FEMALE",
  classArm: "JSS 1A",
  ...over,
});

describe("scanReviewCounts (Smart Import beta)", () => {
  it("counts the cells the admin changed, per field, on the rows they kept", () => {
    const counts = scanReviewCounts(
      [
        { rowNumber: 1, parsedRow: read() },
        { rowNumber: 2, parsedRow: read({ firstName: "Chiamak", dateOfBirth: null, unreadableFields: ["dateOfBirth"] }) },
        { rowNumber: 3, parsedRow: read() },
      ],
      [saved(1), saved(2, { firstName: "Chiamaka", dateOfBirth: "2013-03-01" })],
      "SOME_MISTAKES",
    );
    expect(counts.rowsKept).toBe(2);
    expect(counts.rowsRemoved).toBe(1);
    expect(counts.fields.firstName).toEqual({ changed: 1, flagged: 0 });
    expect(counts.fields.dateOfBirth).toEqual({ changed: 1, flagged: 1 });
    expect(counts.fields.lastName).toEqual({ changed: 0, flagged: 0 });
    expect(counts.rating).toBe("SOME_MISTAKES");
  });

  it("treats a blank read and a blank save as the same, and spaces as no change", () => {
    const counts = scanReviewCounts([{ rowNumber: 1, parsedRow: read({ middleName: null, classArm: " JSS 1A " }) }], [saved(1, { middleName: undefined })], null);
    expect(counts.fields.middleName.changed).toBe(0);
    expect(counts.fields.classArm.changed).toBe(0);
  });

  it("keeps a corrected capital letter as a correction", () => {
    const counts = scanReviewCounts([{ rowNumber: 1, parsedRow: read({ lastName: "okonkwo" }) }], [saved(1)], null);
    expect(counts.fields.lastName.changed).toBe(1);
  });

  it("produces counts only: no text from either side survives into what is stored", () => {
    const counts = scanReviewCounts([{ rowNumber: 1, parsedRow: read({ firstName: "Adaeze" }) }], [saved(1, { firstName: "Adaobi" })], "GOOD");
    const stored = { readSeconds: 12, rowsRead: 1, review: counts };
    expect(scanReviewStatsSchema.parse(stored)).toEqual(stored);
    const text = JSON.stringify(stored);
    for (const value of ["Adaeze", "Adaobi", "Okonkwo", "SKA/001", "2013-02-11", "JSS 1A"]) expect(text).not.toContain(value);
  });
});
