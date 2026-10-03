// Pure assessment compute/validate logic. No DB, no I/O — the load-bearing math
// that score materialization (slice 2 cp2) and the position aggregation pass
// (slice 4) build on. Mirrors grading-rules.ts: validators return a message
// string when INVALID (else null); compute functions are total over their
// inputs. These are unit-tested FIRST (assessment-rules.spec.ts) because slice 4
// ranks students against `totalScore` — if the sum is wrong here, every position
// downstream is wrong.

// EXACT sum of the entered component scores. NO averaging, NO rounding, NO
// extrapolation to a full-marks basis — a partially-entered subject sums only
// what was entered. Scores are stored in already-weighted units (a 60-weight
// Exam is scored 0–60), so the sum IS the 0..100 term total directly.
export function sumComponentScores(scores: readonly number[]): number {
  return scores.reduce((acc, s) => acc + s, 0);
}

// Resolve a total to a letter grade using the school's boundary bands (inclusive
// ranges on both ends). Returns the matching band's letter, or null when no band
// contains the total — a pathological gap; the seeded WAEC bands tile 0..100, so
// in practice every 0..100 total resolves. The lookup does not assume the bands
// are sorted.
export function resolveLetterGrade(
  total: number,
  bands: readonly { letter: string; minScore: number; maxScore: number }[],
): string | null {
  const band = bands.find((b) => total >= b.minScore && total <= b.maxScore);
  return band ? band.letter : null;
}

// Strict score validation against the LIVE component weight (the ceiling — never
// a client-supplied max). Integer, 0..weight inclusive. Returns a message when
// invalid, else null. The DTO does a coarse 0..100 integer check at the edge;
// this is the service-layer re-validation against the resolved component row.
export function findScoreError(score: number, weight: number): string | null {
  if (!Number.isInteger(score)) {
    return "Score must be a whole number.";
  }
  if (score < 0) {
    return "Score cannot be negative.";
  }
  if (score > weight) {
    return `Score cannot exceed the component's maximum of ${weight}.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Phase 8c / CP5a — marks out of any total (docs/modules/phase-8.md §22.1).
// ---------------------------------------------------------------------------

/** The largest "out of" a teacher may enter a mark against. */
export const MAX_RAW_OUT_OF = 1000;

/**
 * Scale a mark entered "out of" some total into a component's weight, rounding
 * half up to a whole number (D60): 37/60 into a weight of 20 is 12.33 → 12,
 * 15/40 into 20 is 7.5 → 8.
 *
 * Integer arithmetic only — round(m·w/o) half up is floor((2·m·w + o) / (2·o))
 * — so no floating-point product can land a hair under .5 and round the wrong
 * way. Assumes a valid mark (0 ≤ mark ≤ outOf, outOf ≥ 1); check with
 * findRawMarkError first.
 */
export function scaleRawMark(mark: number, outOf: number, weight: number): number {
  return Math.floor((2 * mark * weight + outOf) / (2 * outOf));
}

/** null when the raw mark and its total are usable; otherwise why not. */
export function findRawMarkError(mark: number, outOf: number): string | null {
  if (!Number.isInteger(outOf) || outOf < 1 || outOf > MAX_RAW_OUT_OF) {
    return `"Out of" must be a whole number from 1 to ${MAX_RAW_OUT_OF}.`;
  }
  if (!Number.isInteger(mark)) return "Mark must be a whole number.";
  if (mark < 0) return "Mark cannot be negative.";
  if (mark > outOf) return `Mark cannot be more than ${outOf}.`;
  return null;
}
