// Phase 8c / CP5a — cumulative results across a year's terms
// (docs/modules/phase-8.md §22.1, D61). Pure, so the arithmetic is specified
// by tests rather than by whoever next edits the report-card build.
//
// D61: average the terms a student HAS. A term with no result is absent from
// the average, never a zero — a mid-year admission is not punished for a term
// they were not there for — and the count travels with the average so a card
// can say "based on 2 terms".

/** One subject's year so far: average in hundredths, over how many terms. */
export interface CumulativeSubject {
  subjectId: string;
  average: number; // Int hundredths (7350 = 73.50)
  terms: number;
}

/** round(n / d) half up, for non-negative integers, without floating point. */
export function roundHalfUpDiv(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}

/**
 * The cumulative average of a student's term averages (each already in
 * hundredths), over the terms present. null when there is none.
 */
export function cumulativeAverage(termAverages: readonly (number | null)[]): { average: number; terms: number } | null {
  const present = termAverages.filter((a): a is number => a !== null);
  if (present.length === 0) return null;
  return { average: roundHalfUpDiv(present.reduce((s, a) => s + a, 0), present.length), terms: present.length };
}

/**
 * Per-subject cumulative averages from that subject's term totals (each 0..100,
 * whole marks), in hundredths. Subjects are returned in the order given.
 */
export function cumulativeSubjects(totalsBySubject: ReadonlyMap<string, readonly number[]>): CumulativeSubject[] {
  const out: CumulativeSubject[] = [];
  for (const [subjectId, totals] of totalsBySubject) {
    if (totals.length === 0) continue;
    out.push({
      subjectId,
      average: roundHalfUpDiv(totals.reduce((s, t) => s + t, 0) * 100, totals.length),
      terms: totals.length,
    });
  }
  return out;
}

/**
 * Read the cumulativeSubjects JSON a card stores, keeping only well-formed
 * entries. The column is written by one function (the report-card build), but
 * JSON is not typed by the database, so every read narrows it here rather
 * than trusting a cast.
 */
export function readCumulativeSubjects(json: unknown): CumulativeSubject[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (e): e is CumulativeSubject =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as CumulativeSubject).subjectId === "string" &&
      Number.isInteger((e as CumulativeSubject).average) &&
      Number.isInteger((e as CumulativeSubject).terms),
  );
}
