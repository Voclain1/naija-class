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
