import {
  SCAN_REVIEW_FIELDS,
  type ExtractedStudentRow,
  type ReviewedStudentRow,
  type ScanRating,
  type ScanReviewField,
  type ScanReviewStats,
} from "@school-kit/types";

// Smart Import beta (docs/modules/smart-student-import.md §9): how the reading
// went, as COUNTS. The server compares what it read (the job's
// previewSnapshot) with what the admin saved, row by row on rowNumber, field
// by field. Nothing returned here carries text: the result is stored on the
// import job and read by SchoolKit across schools, so a name or a number in
// it would be a copy of a child's details outside the school's own records.

/** What extraction stored in previewSnapshot.good. */
export interface ReadRow {
  rowNumber: number;
  parsedRow: ExtractedStudentRow;
}

/** One cell as a comparable string: trimmed, blank for null. Case is kept: a corrected capital is a correction. */
function cell(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function scanReviewCounts(
  read: readonly ReadRow[],
  saved: readonly ReviewedStudentRow[],
  rating: ScanRating | null,
): NonNullable<ScanReviewStats["review"]> {
  const savedByRow = new Map(saved.map((r) => [r.rowNumber, r]));
  const fields = Object.fromEntries(SCAN_REVIEW_FIELDS.map((f) => [f, { changed: 0, flagged: 0 }])) as Record<
    ScanReviewField,
    { changed: number; flagged: number }
  >;
  let rowsKept = 0;
  let rowsRemoved = 0;
  for (const { rowNumber, parsedRow } of read) {
    const after = savedByRow.get(rowNumber);
    if (!after) {
      rowsRemoved += 1;
      continue;
    }
    rowsKept += 1;
    for (const field of SCAN_REVIEW_FIELDS) {
      if (cell(parsedRow[field]) !== cell(after[field])) fields[field].changed += 1;
      if (parsedRow.unreadableFields.includes(field)) fields[field].flagged += 1;
    }
  }
  return { rowsKept, rowsRemoved, fields, rating };
}
