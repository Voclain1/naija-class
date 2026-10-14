"use client";

import Link from "next/link";

import { formatCalendarDate, formatHundredths, type AttendanceReportDto } from "@school-kit/types";

import { AnalyticsPage, ReportSection, useAnalyticsAccess, useTermReport } from "@/components/reports/analytics-shell";
import { ExportMenu } from "@/components/shared/export-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { downloadAnalyticsExcel, getAttendanceReport, percent, requestAnalyticsPdf } from "@/lib/reports/analytics-api";
import { cn } from "@/lib/utils";

// /reports/attendance — Phase 9 / CP1.2 (docs/modules/phase-9.md §8.3).
// Rate = (present + late) ÷ records marked, as everywhere else in SchoolKit.
// "Days with no register" uses the Recording report's school days, so the two
// pages always agree.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const weekLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

interface WholeReportExport {
  onExcel?: () => Promise<void>;
  onPdf?: () => ReturnType<typeof requestAnalyticsPdf>;
}

export default function AttendanceReportPage() {
  const { canRead, canExport } = useAnalyticsAccess();
  const { termId, data, loading, error, reload } = useTermReport(getAttendanceReport, canRead);
  const whole: WholeReportExport = canExport
    ? { onExcel: () => downloadAnalyticsExcel("attendance", termId), onPdf: () => requestAnalyticsPdf("attendance", termId) }
    : {};

  return (
    <AnalyticsPage
      title="Attendance"
      description="Present or late, out of the days each student was marked. Excused counts as marked but not attended."
      canRead={canRead}
      loading={loading}
      error={error}
      onRetry={() => void reload()}
      term={data ? data.term : undefined}
    >
      {data ? (
        <div className="flex flex-col gap-8">
          <WeeklyAttendance report={data} {...whole} />
          <OftenAbsent report={data} {...whole} />
          <MissingRegisters report={data} {...whole} />
        </div>
      ) : null}
    </AnalyticsPage>
  );
}

function WeeklyAttendance({ report, onExcel, onPdf }: { report: AttendanceReportDto } & WholeReportExport) {
  const line = report.thresholdPercent * 100;
  if (report.classes.length === 0) {
    return (
      <ReportSection id="weekly" title="Week by week">
        <p className="text-sm text-muted-foreground">No class has students enrolled in this term.</p>
      </ReportSection>
    );
  }
  return (
    <ReportSection
      id="weekly"
      title="Week by week"
      actions={
        <ExportMenu
          onCsv={() =>
            exportRowsAsCsv("weekly-attendance.csv", report.classes, [
              { header: "Class", accessor: (c) => c.label },
              { header: "Level", accessor: (c) => c.classLevelName },
              ...report.weeks.map((wk, i) => ({
                header: `w/c ${weekLabel(wk)} %`,
                accessor: (c: AttendanceReportDto["classes"][number]) => {
                  const v = c.weeks[i]?.rateHundredths ?? null;
                  return v === null ? "" : formatHundredths(v);
                },
              })),
              { header: "Term %", accessor: (c) => (c.termRateHundredths === null ? "" : formatHundredths(c.termRateHundredths)) },
            ])
          }
          onExcel={onExcel}
          onPdf={onPdf}
          excelLabel="Excel (whole report)"
          pdfLabel="PDF (whole report)"
        />
      }
      note={
        <>
          Weeks below the school&apos;s {report.thresholdPercent}% line are{" "}
          <span className="rounded bg-amber-500/15 px-1 text-amber-900 dark:text-amber-200">shaded</span>.
        </>
      }
    >
      <div className="max-w-full overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 bg-card px-3 py-2 text-left font-medium">
                Class
              </th>
              {report.weeks.map((wk) => (
                <th key={wk} scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  w/c {weekLabel(wk)}
                </th>
              ))}
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">
                Term
              </th>
            </tr>
          </thead>
          <tbody>
            {report.classes.map((c) => (
              <tr key={c.groupId} className="border-t">
                <th scope="row" className="sticky left-0 whitespace-nowrap bg-card px-3 py-2 text-left font-medium">
                  {c.label}
                </th>
                {c.weeks.map((w) => (
                  <td
                    key={w.weekStart}
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-right tabular-nums",
                      w.rateHundredths !== null && w.rateHundredths < line && "bg-amber-500/15 text-amber-900 dark:text-amber-200",
                    )}
                  >
                    {percent(w.rateHundredths)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{percent(c.termRateHundredths)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportSection>
  );
}

function OftenAbsent({ report, onExcel, onPdf }: { report: AttendanceReportDto } & WholeReportExport) {
  const { permissions } = useAuth();
  const canChange = hasPermission(permissions, "school.update");
  const exportActions = report.chronicAbsence.length > 0 ? (
    <ExportMenu
      onCsv={() =>
        exportRowsAsCsv("often-absent.csv", report.chronicAbsence, [
          { header: "Student", accessor: (s) => s.name },
          { header: "Admission no.", accessor: (s) => s.admissionNumber },
          { header: "Class", accessor: (s) => s.classLabel },
          { header: "Days marked", accessor: (s) => s.daysMarked },
          { header: "Days absent", accessor: (s) => s.daysAbsent },
          { header: "Attendance %", accessor: (s) => formatHundredths(s.rateHundredths) },
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
      id="often-absent"
      title={`Often absent — below ${report.thresholdPercent}%`}
      note={
        <>
          Students whose attendance this term is under the school&apos;s line, lowest first.
          {canChange ? (
            <>
              {" "}
              <Link href="/settings/attendance" className="underline underline-offset-2">
                Change the line
              </Link>
              .
            </>
          ) : null}
        </>
      }
    >
      {report.chronicAbsence.length === 0 ? (
        <p className="text-sm text-muted-foreground">No student is below {report.thresholdPercent}% this term.</p>
      ) : (
        <>
          <Table stackOnMobile>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Admission no.</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Days marked</TableHead>
                <TableHead className="text-right">Days absent</TableHead>
                <TableHead className="text-right">Attendance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.chronicAbsence.map((s) => (
                <TableRow key={s.studentId}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.admissionNumber}</TableCell>
                  <TableCell>{s.classLabel}</TableCell>
                  <TableCell className="text-right">{s.daysMarked}</TableCell>
                  <TableCell className="text-right">{s.daysAbsent}</TableCell>
                  <TableCell className="text-right">{percent(s.rateHundredths)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </ReportSection>
  );
}

function MissingRegisters({ report, onExcel, onPdf }: { report: AttendanceReportDto } & WholeReportExport) {
  const exportActions = report.missingRegisters.length > 0 ? (
    <ExportMenu
      onCsv={() =>
        exportRowsAsCsv("days-with-no-register.csv", report.missingRegisters, [
          { header: "Class", accessor: (m) => m.label },
          { header: "School days missed", accessor: (m) => m.dates.length },
          { header: "Dates", accessor: (m) => m.dates.join(" ") },
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
      id="missing-registers"
      title="Days with no register"
      note="School days so far this term on which a class's register was not taken. Holidays and breaks are not counted."
    >
      {report.missingRegisters.length === 0 ? (
        <p className="text-sm text-muted-foreground">Every class has a register for every school day so far.</p>
      ) : (
        <>
          <Table stackOnMobile>
            <TableHeader>
              <TableRow>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Dates</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.missingRegisters.map((m) => (
                <TableRow key={m.groupId}>
                  <TableCell className="font-medium">{m.label}</TableCell>
                  <TableCell className="text-right">{m.dates.length}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {m.dates.slice(0, 10).map(formatCalendarDate).join(", ")}
                    {m.dates.length > 10 ? `, and ${m.dates.length - 10} more` : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </ReportSection>
  );
}
