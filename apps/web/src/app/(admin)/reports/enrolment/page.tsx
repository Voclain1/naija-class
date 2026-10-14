"use client";

import type { EnrolmentMoverDto, EnrolmentReportDto } from "@school-kit/types";

import { AnalyticsPage, ReportSection, useAnalyticsAccess, useTermReport } from "@/components/reports/analytics-shell";
import { ExportMenu } from "@/components/shared/export-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { downloadAnalyticsExcel, getEnrolmentReport, requestAnalyticsPdf } from "@/lib/reports/analytics-api";

// /reports/enrolment — Phase 9 / CP1.2 (docs/modules/phase-9.md §8.3).
// "On roll" = enrolled in the term and not withdrawn or transferred during it.

interface WholeReportExport {
  onExcel?: () => Promise<void>;
  onPdf?: () => ReturnType<typeof requestAnalyticsPdf>;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export default function EnrolmentReportPage() {
  const { canRead, canExport } = useAnalyticsAccess();
  const { termId, data, loading, error, reload } = useTermReport(getEnrolmentReport, canRead);
  const whole: WholeReportExport = canExport
    ? { onExcel: () => downloadAnalyticsExcel("enrolment", termId), onPdf: () => requestAnalyticsPdf("enrolment", termId) }
    : {};

  return (
    <AnalyticsPage
      title="Enrolment"
      description="Students on roll by level, compared with the term before, and who joined or left."
      canRead={canRead}
      loading={loading}
      error={error}
      onRetry={() => void reload()}
      term={data ? data.term : undefined}
    >
      {data ? (
        <div className="flex flex-col gap-8">
          <Levels report={data} {...whole} />
          {data.previousTerm ? (
            <>
              <Movers id="joiners" title="Joined this term" rows={data.joiners} empty="No one joined this term." file="joiners.csv" {...whole} />
              <Movers id="leavers" title="Left since last term" rows={data.leavers} empty="No one left since last term." file="leavers.csv" {...whole} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">This is the school&apos;s first term in SchoolKit, so there is no one to compare with.</p>
          )}
        </div>
      ) : null}
    </AnalyticsPage>
  );
}

function Levels({ report, onExcel, onPdf }: { report: EnrolmentReportDto } & WholeReportExport) {
  const prev = report.previousTerm;
  const exportActions = report.levels.length > 0 ? (
    <ExportMenu
      onCsv={() =>
        exportRowsAsCsv("students-per-level.csv", report.levels, [
          { header: "Level", accessor: (l) => l.label },
          { header: "This term", accessor: (l) => l.thisTerm },
          { header: "Previous term", accessor: (l) => l.previousTerm ?? "" },
          { header: "Change", accessor: (l) => (l.previousTerm === null ? "" : l.thisTerm - l.previousTerm) },
        ])
      }
      onExcel={onExcel}
      onPdf={onPdf}
      excelLabel="Excel (whole report)"
      pdfLabel="PDF (whole report)"
    />
  ) : null;
  return (
    <ReportSection
      actions={exportActions}
      id="levels"
      title="Students per level"
      note={prev ? `Compared with ${prev.name} (${prev.academicYearLabel}).` : undefined}
    >
      {report.levels.length === 0 ? (
        <p className="text-sm text-muted-foreground">No students are enrolled in this term.</p>
      ) : (
        <>
          <Table stackOnMobile>
            <TableHeader>
              <TableRow>
                <TableHead>Level</TableHead>
                <TableHead className="text-right">This term</TableHead>
                {prev ? <TableHead className="text-right">Last term</TableHead> : null}
                {prev ? <TableHead className="text-right">Change</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.levels.map((l) => (
                <TableRow key={l.groupId}>
                  <TableCell className="font-medium">{l.label}</TableCell>
                  <TableCell className="text-right">{l.thisTerm}</TableCell>
                  {prev ? <TableCell className="text-right">{l.previousTerm ?? 0}</TableCell> : null}
                  {prev ? <TableCell className="text-right">{signed(l.thisTerm - (l.previousTerm ?? 0))}</TableCell> : null}
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-medium">All levels</TableCell>
                <TableCell className="text-right font-medium">{report.totals.thisTerm}</TableCell>
                {prev ? <TableCell className="text-right font-medium">{report.totals.previousTerm ?? 0}</TableCell> : null}
                {prev ? (
                  <TableCell className="text-right font-medium">
                    {signed(report.totals.thisTerm - (report.totals.previousTerm ?? 0))}
                  </TableCell>
                ) : null}
              </TableRow>
            </TableBody>
          </Table>
        </>
      )}
    </ReportSection>
  );
}

function Movers({
  id,
  title,
  rows,
  empty,
  file,
  onExcel,
  onPdf,
}: { id: string; title: string; rows: EnrolmentMoverDto[]; empty: string; file: string } & WholeReportExport) {
  const exportActions = rows.length > 0 ? (
    <ExportMenu
      onCsv={() =>
        exportRowsAsCsv(file, rows, [
          { header: "Student", accessor: (m) => m.name },
          { header: "Admission no.", accessor: (m) => m.admissionNumber },
          { header: "Class", accessor: (m) => m.classLabel },
          { header: "Reason", accessor: (m) => m.reason },
        ])
      }
      onExcel={onExcel}
      onPdf={onPdf}
      excelLabel="Excel (whole report)"
      pdfLabel="PDF (whole report)"
    />
  ) : null;
  return (
    <ReportSection actions={exportActions} id={id} title={`${title} (${rows.length})`}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <>
          <Table stackOnMobile>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Admission no.</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.studentId}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>{m.admissionNumber}</TableCell>
                  <TableCell>{m.classLabel}</TableCell>
                  <TableCell>{m.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </ReportSection>
  );
}
