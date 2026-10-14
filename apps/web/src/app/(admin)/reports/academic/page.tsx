"use client";

import { formatHundredths, type AcademicReportDto } from "@school-kit/types";

import { AnalyticsPage, ReportSection, useAnalyticsAccess, useTermReport } from "@/components/reports/analytics-shell";
import { ExportMenu } from "@/components/shared/export-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportRowsAsCsv } from "@/lib/csv-export";
import {
  changeWords,
  downloadAnalyticsExcel,
  getAcademicReport,
  requestAnalyticsPdf,
  scoreBand,
  type ScoreBand,
} from "@/lib/reports/analytics-api";
import { cn } from "@/lib/utils";

// /reports/academic — Phase 9 / CP1.2 (docs/modules/phase-9.md §8.3).
// Released report cards only (CP1-D4): a class appears once its cards are
// released, so a mark still in review never reaches this page.

// Tints, never an edge (CLAUDE.md, no accent borders); the number is always
// printed, and the legend says in words what each shade means.
const BAND_CLASS: Record<ScoreBand, string> = {
  high: "bg-primary/15",
  middle: "bg-secondary/25",
  low: "bg-destructive/15",
};

export default function AcademicReportPage() {
  const { canRead, canExport } = useAnalyticsAccess();
  const { termId, data, loading, error, reload } = useTermReport(getAcademicReport, canRead);
  const excel = canExport ? () => downloadAnalyticsExcel("academic", termId) : undefined;
  const pdf = canExport ? () => requestAnalyticsPdf("academic", termId) : undefined;
  const hasResults = (data?.classes.length ?? 0) > 0;

  return (
    <AnalyticsPage
      title="Academic results"
      description="Averages from released report cards only. A class appears here once its report cards are released."
      canRead={canRead}
      loading={loading}
      error={error}
      onRetry={() => void reload()}
      term={data ? data.term : undefined}
    >
      {data && !hasResults ? (
        <p className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          No report cards have been released for this term yet.
        </p>
      ) : data ? (
        <div className="flex flex-col gap-8">
          <ClassAverages report={data} onExcel={excel} onPdf={pdf} />
          <SubjectHeatmap report={data} onExcel={excel} onPdf={pdf} />
          <Rankings report={data} onExcel={excel} onPdf={pdf} />
        </div>
      ) : null}
    </AnalyticsPage>
  );
}

interface WholeReportExport {
  onExcel?: () => Promise<void>;
  onPdf?: () => ReturnType<typeof requestAnalyticsPdf>;
}

function ClassAverages({ report, onExcel, onPdf }: { report: AcademicReportDto } & WholeReportExport) {
  const prev = report.previousTerm;
  const exportActions = (
    <ExportMenu
      onCsv={() =>
        exportRowsAsCsv("class-averages.csv", report.classes, [
          { header: "Class", accessor: (c) => c.label },
          { header: "Level", accessor: (c) => c.classLevelName },
          { header: "Students counted", accessor: (c) => c.releasedCount },
          { header: "Average %", accessor: (c) => formatHundredths(c.averageHundredths) },
          { header: "Previous term %", accessor: (c) => (c.previousAverageHundredths === null ? "" : formatHundredths(c.previousAverageHundredths)) },
          { header: "Change", accessor: (c) => (c.changeHundredths === null ? "" : formatHundredths(c.changeHundredths)) },
        ])
      }
      onExcel={onExcel}
      onPdf={onPdf}
      excelLabel="Excel (whole report)"
      pdfLabel="PDF (whole report)"
    />
  );
  return (
    <ReportSection
      actions={exportActions}
      id="class-averages"
      title="Class averages"
      note={
        prev
          ? `Compared with ${prev.name} (${prev.academicYearLabel}), for the same class.`
          : "There is no earlier term to compare with."
      }
    >
      <Table stackOnMobile>
        <TableHeader>
          <TableRow>
            <TableHead>Class</TableHead>
            <TableHead>Level</TableHead>
            <TableHead className="text-right">Students</TableHead>
            <TableHead className="text-right">Average</TableHead>
            <TableHead className="text-right">Last term</TableHead>
            <TableHead className="text-right">Change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.classes.map((c) => (
            <TableRow key={c.groupId}>
              <TableCell className="font-medium">{c.label}</TableCell>
              <TableCell>{c.classLevelName}</TableCell>
              <TableCell className="text-right">{c.releasedCount}</TableCell>
              <TableCell className="text-right">{formatHundredths(c.averageHundredths)}</TableCell>
              <TableCell className="text-right">{formatHundredths(c.previousAverageHundredths)}</TableCell>
              <TableCell
                className={cn(
                  "text-right",
                  c.changeHundredths !== null && c.changeHundredths < 0 && "text-amber-700 dark:text-amber-300",
                )}
              >
                {changeWords(c.changeHundredths)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportSection>
  );
}

function SubjectHeatmap({ report, onExcel, onPdf }: { report: AcademicReportDto } & WholeReportExport) {
  const cell = new Map(report.cells.map((c) => [`${c.groupId}|${c.subjectId}`, c]));
  const subjectName = new Map(report.subjects.map((s) => [s.subjectId, s.subjectName]));
  const classLabel = new Map(report.classes.map((c) => [c.groupId, c.label]));
  const exportActions = report.cells.length > 0 ? (
    <ExportMenu
      onCsv={() =>
        exportRowsAsCsv("subject-averages.csv", report.cells, [
          { header: "Class", accessor: (c) => classLabel.get(c.groupId) ?? "" },
          { header: "Subject", accessor: (c) => subjectName.get(c.subjectId) ?? "" },
          { header: "Students", accessor: (c) => c.studentCount },
          { header: "Average %", accessor: (c) => formatHundredths(c.averageHundredths) },
        ])
      }
      onExcel={onExcel}
      onPdf={onPdf}
      excelLabel="Excel (whole report)"
      pdfLabel="PDF (whole report)"
    />
  ) : null;
  return (
    <ReportSection actions={exportActions} id="subject-averages" title="Subject averages by class">
      {report.cells.length === 0 ? (
        <p className="text-sm text-muted-foreground">No subject marks are on the released report cards yet.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Each box is the class&apos;s average mark in that subject. Shaded{" "}
          <span className={cn("rounded px-1", BAND_CLASS.high)}>70 and above</span>,{" "}
          <span className={cn("rounded px-1", BAND_CLASS.middle)}>50 to 69</span> and{" "}
          <span className={cn("rounded px-1", BAND_CLASS.low)}>below 50</span>.
        </p>
        {/* A grid, where the columns are the point: it scrolls inside its own box
            on a narrow screen rather than stacking or spilling off the page. */}
        <div className="max-w-full overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 bg-card px-3 py-2 text-left font-medium">
                  Class
                </th>
                {report.subjects.map((s) => (
                  <th key={s.subjectId} scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">
                    {s.subjectName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.classes.map((c) => (
                <tr key={c.groupId} className="border-t">
                  <th scope="row" className="sticky left-0 whitespace-nowrap bg-card px-3 py-2 text-left font-medium">
                    {c.label}
                  </th>
                  {report.subjects.map((s) => {
                    const v = cell.get(`${c.groupId}|${s.subjectId}`);
                    return (
                      <td
                        key={s.subjectId}
                        className={cn("whitespace-nowrap px-3 py-2 text-right", v && BAND_CLASS[scoreBand(v.averageHundredths)])}
                        title={v ? `${v.studentCount} students` : undefined}
                      >
                        {v ? formatHundredths(v.averageHundredths) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </ReportSection>
  );
}

function Rankings({ report, onExcel, onPdf }: { report: AcademicReportDto } & WholeReportExport) {
  const rows = report.rankings.flatMap((r) => [
    ...r.top.map((s, i) => ({ ...s, classLabel: r.label, list: "Top", place: i + 1 })),
    ...r.bottom.map((s, i) => ({ ...s, classLabel: r.label, list: "Bottom", place: i + 1 })),
  ]);
  const exportActions = (
    <ExportMenu
      onCsv={() =>
        exportRowsAsCsv("top-and-bottom-students.csv", rows, [
          { header: "Class", accessor: (s) => s.classLabel },
          { header: "List", accessor: (s) => s.list },
          { header: "Place", accessor: (s) => s.place },
          { header: "Student", accessor: (s) => s.name },
          { header: "Admission no.", accessor: (s) => s.admissionNumber },
          { header: "Average %", accessor: (s) => formatHundredths(s.averageHundredths) },
        ])
      }
      onExcel={onExcel}
      onPdf={onPdf}
      excelLabel="Excel (whole report)"
      pdfLabel="PDF (whole report)"
    />
  );
  return (
    <ReportSection actions={exportActions} id="rankings" title="Top and bottom students" note="By overall average on the released report card.">
      <div className="grid gap-4 md:grid-cols-2">
        {report.rankings.map((r) => (
          <div key={r.groupId} className="flex min-w-0 flex-col gap-3 rounded-md border bg-card p-4">
            <h3 className="font-medium">{r.label}</h3>
            <RankList title="Top" students={r.top} />
            {r.bottom.length > 0 ? (
              <RankList title="Bottom (lowest first)" students={r.bottom} />
            ) : (
              <p className="text-xs text-muted-foreground">Too few students for a separate bottom list.</p>
            )}
          </div>
        ))}
      </div>
    </ReportSection>
  );
}

function RankList({ title, students }: { title: string; students: AcademicReportDto["rankings"][number]["top"] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <ol className="flex flex-col gap-1 text-sm">
        {students.map((s, i) => (
          <li key={s.studentId} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">
              {i + 1}. {s.name} <span className="text-xs text-muted-foreground">{s.admissionNumber}</span>
            </span>
            <span className="shrink-0 tabular-nums">{formatHundredths(s.averageHundredths)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
