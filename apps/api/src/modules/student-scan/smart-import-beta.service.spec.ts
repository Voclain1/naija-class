import { describe, expect, it } from "vitest";

import type { ScanReviewStats } from "@school-kit/types";

import { sumScanStats } from "./smart-import-beta.service";

const zero = { changed: 0, flagged: 0 };
const fields = (over: Partial<Record<string, { changed: number; flagged: number }>> = {}) => ({
  admissionNumber: zero,
  firstName: zero,
  middleName: zero,
  lastName: zero,
  dateOfBirth: zero,
  gender: zero,
  classArm: zero,
  ...over,
});

describe("sumScanStats (Smart Import beta results)", () => {
  it("adds up pages, rows, cells changed per field, ratings and read times", () => {
    const jobs: ScanReviewStats[] = [
      { readSeconds: 20, rowsRead: 30, review: { rowsKept: 28, rowsRemoved: 2, fields: fields({ lastName: { changed: 3, flagged: 1 } }), rating: "SOME_MISTAKES" } },
      { readSeconds: 40, rowsRead: 10, review: { rowsKept: 10, rowsRemoved: 0, fields: fields({ lastName: { changed: 1, flagged: 0 } }), rating: "GOOD" } },
      // Read but never saved: counts towards pages and time, not cells.
      { readSeconds: 30, rowsRead: 12, review: null },
    ];
    const totals = sumScanStats(jobs);
    expect(totals).toMatchObject({ scans: 3, scansSaved: 2, rowsRead: 52, rowsKept: 38, rowsRemoved: 2, averageReadSeconds: 30, slowestReadSeconds: 40 });
    expect(totals.fields.find((f) => f.field === "lastName")).toEqual({ field: "lastName", compared: 38, changed: 4, flagged: 1 });
    expect(totals.ratings).toEqual({ GOOD: 1, SOME_MISTAKES: 1, MANY_MISTAKES: 0 });
  });

  it("says nothing about time when nothing has been read", () => {
    expect(sumScanStats([])).toMatchObject({ scans: 0, averageReadSeconds: null, slowestReadSeconds: null });
  });
});
