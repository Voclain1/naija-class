import { PROMOTION_STATUS_LABELS, type ReleasedResultDetailDto } from "@school-kit/types";

// One released term, as a family reads it (Phase 8 / CP6a §20.4) — shared by
// the signed-in term page and the public Result Checker (CP6b §21.7), so the
// two can never show the same card differently.

export function formatAverage(hundredths: number | null): string {
  if (hundredths === null) return "—";
  return `${Math.trunc(hundredths / 100)}.${Math.abs(hundredths % 100)
    .toString()
    .padStart(2, "0")}%`;
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? "th" : mod10 === 1 ? "st" : mod10 === 2 ? "nd" : mod10 === 3 ? "rd" : "th";
  return `${value}${suffix}`;
}

export function ResultCard({ result }: { result: ReleasedResultDetailDto }) {
  return (
    <div className="flex flex-col gap-4">
      {result.promotionStatus ? (
        // Tinted, never an accent border (CLAUDE.md); the decision in words.
        <section className="rounded-lg bg-primary/10 p-4" aria-label="Promotion status">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Promotion status</p>
          <p className="font-serif text-xl text-foreground">{PROMOTION_STATUS_LABELS[result.promotionStatus]}</p>
        </section>
      ) : null}

      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-muted-foreground">Average</dt><dd>{formatAverage(result.overallAverage)}</dd></div>
          <div><dt className="text-muted-foreground">Total</dt><dd>{result.overallTotal ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Subjects</dt><dd>{result.subjectsCount ?? "—"}</dd></div>
          {/* Only when the school shows position to families; never a dash. */}
          {result.overallPosition !== null ? (
            <div><dt className="text-muted-foreground">Position</dt><dd>{ordinal(result.overallPosition)}</dd></div>
          ) : null}
        </dl>
        {result.cumulative ? (
          // Phase 8c / CP5a (D61): the year so far, final term only, averaged
          // over the terms the student has — and it says how many.
          <p className="mt-3 text-sm text-muted-foreground">
            Year average: {formatAverage(result.cumulative.average)} over {result.cumulative.terms} term
            {result.cumulative.terms === 1 ? "" : "s"}
            {result.cumulative.position !== null ? `, ${ordinal(result.cumulative.position)} in class` : ""}.
          </p>
        ) : null}
        {result.attendance ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Attendance: present {result.attendance.present} of {result.attendance.daysOpened} days, absent{" "}
            {result.attendance.absent}.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <h2 className="mb-2 font-semibold">Subjects</h2>
        {result.subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No subject scores were recorded for this term.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-normal">Subject</th>
                <th className="py-1 text-right font-normal">Score</th>
                <th className="py-1 text-right font-normal">Grade</th>
                {result.subjects.some((s) => s.subjectPosition !== null) ? (
                  <th className="py-1 text-right font-normal">Position</th>
                ) : null}
                {result.cumulative ? <th className="py-1 text-right font-normal">Year avg</th> : null}
              </tr>
            </thead>
            <tbody>
              {result.subjects.map((s) => (
                <tr key={s.subjectId} className="border-t">
                  <td className="py-1.5">
                    {s.subjectName}
                    {s.remark ? <span className="block text-xs text-muted-foreground">{s.remark}</span> : null}
                  </td>
                  <td className="py-1.5 text-right">{s.totalScore}</td>
                  <td className="py-1.5 text-right">{s.letterGrade ?? "—"}</td>
                  {result.subjects.some((x) => x.subjectPosition !== null) ? (
                    <td className="py-1.5 text-right">
                      {s.subjectPosition !== null ? ordinal(s.subjectPosition) : "—"}
                    </td>
                  ) : null}
                  {result.cumulative ? (
                    <td className="py-1.5 text-right">
                      {typeof s.cumulativeAverage === "number" ? formatAverage(s.cumulativeAverage) : "—"}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {result.formTeacherComment ? (
        <section className="rounded-lg border bg-card p-4 shadow-sm">
          <h2 className="mb-1 font-semibold">Form teacher&apos;s comment</h2>
          <p className="whitespace-pre-wrap text-sm">{result.formTeacherComment}</p>
        </section>
      ) : null}
      {result.principalNote ? (
        <section className="rounded-lg border bg-card p-4 shadow-sm">
          <h2 className="mb-1 font-semibold">Principal&apos;s remark</h2>
          <p className="whitespace-pre-wrap text-sm">{result.principalNote}</p>
        </section>
      ) : null}
    </div>
  );
}
