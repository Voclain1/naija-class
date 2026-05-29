// Shared row-result shapes for CSV imports. Generic in the parsed-row
// type so a student row and a guardian row share the same accumulator
// shape — `good` carries the typed payload, `bad` is row-shape-agnostic
// (only field names + messages, no parsed payload).
//
// The validate engine uses these to express its result, and the commit
// handler uses them to accumulate commit-time row errors. The bad-rows
// CSV writer (badRowsToCsv) consumes the bad-shape directly and emits
// the same `_errors` column for every import type.

export type ImportRowError = {
  rowNumber: number; // 1-indexed data row (header is row 0)
  csvRow: Record<string, string>;
  errors: Array<{ field: string; message: string }>;
};

export type ImportRowGood<Row> = {
  rowNumber: number;
  parsedRow: Row;
};
