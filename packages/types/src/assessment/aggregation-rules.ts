// Pure position-aggregation logic (Phase 2 / Slice 4). NO DB, no I/O — the
// load-bearing math that decides class/subject positions, which land on the
// materialized PDFs schools physically distribute. This is the most
// correctness-critical code in Phase 2, so it is written test-first
// (aggregation-rules.spec.ts enumerates the ranking spec as discrete cases) and
// kept entirely pure. The slice-4 service is a thin DB shell over these.
//
// Mirrors assessment-rules.ts: total functions over their inputs, no side
// effects. Positions use SPARSE competition ranking ("1, 1, 3" — two joint-1st,
// next is 3rd), the universal Nigerian report-card convention.

export interface RankItem {
  id: string;
  value: number;
}

// Sparse competition ranking, descending by value. Ties SHARE a rank and the
// next distinct value skips ("1, 1, 3", not "1, 1, 2"). Among equal values the
// order is a stable secondary sort by id — this never changes the assigned rank
// (ties share it) but makes iteration deterministic, so test output is
// reproducible. THE core used by both position functions.
export function rankSparse(items: readonly RankItem[]): Map<string, number> {
  const sorted = [...items].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const result = new Map<string, number>();
  let prevValue: number | null = null;
  let rank = 0;
  let position = 0; // 1-based index in the sorted order
  for (const item of sorted) {
    position += 1;
    if (prevValue === null || item.value !== prevValue) {
      rank = position; // sparse: a new distinct value jumps to its position
    }
    result.set(item.id, rank);
    prevValue = item.value;
  }
  return result;
}

// One subject's positions. Consumes the (student × subject) summaries for ONE
// subject in ONE arm-term and returns studentId → subjectPosition. Students not
// in `rows` (unscored, withdrawn — the service filters the denominator to the
// live ENROLLED roster) are simply absent from the result; they have no
// position. Partial totals are ranked at face value (an 18-mark CA1-only row
// ranks at 18).
export interface SubjectAssessment {
  studentId: string;
  totalScore: number;
}

export function computeSubjectPositions(
  rows: readonly SubjectAssessment[],
): Map<string, number> {
  return rankSparse(rows.map((r) => ({ id: r.studentId, value: r.totalScore })));
}

// Average each student's total across the subjects they HAVE a summary for,
// stored as an Int in hundredths (the money/kobo rule — no Float in grade math;
// matches ReportCard.overallAverage). KNOWN LIMITATION (Q1f): a student with a
// subset of subjects averages only what's entered, so one strong early subject
// can inflate the average — the slice-6 report-card build re-aggregates before
// release, after all subjects are in. A student with no totals is excluded from
// the result (no average → no class position).
export function computeClassAverages(
  totalsByStudent: ReadonlyMap<string, readonly number[]>,
): Map<string, number> {
  const averages = new Map<string, number>();
  for (const [studentId, totals] of totalsByStudent) {
    if (totals.length === 0) continue;
    const sum = totals.reduce((acc, t) => acc + t, 0);
    averages.set(studentId, Math.round((sum * 100) / totals.length));
  }
  return averages;
}

// Overall class positions, ranking students by their overallAverage (hundredths)
// descending. INDEPENDENT of computeSubjectPositions — a subject-narrowed pass
// recomputes only subject positions and must NEVER derive class positions from
// them (Q1j: compute scopes must be narrower than write scopes). A student
// absent from `averages` (no subjects yet) gets no class position.
export function computeClassPositions(
  averages: ReadonlyMap<string, number>,
): Map<string, number> {
  return rankSparse([...averages].map(([id, value]) => ({ id, value })));
}
