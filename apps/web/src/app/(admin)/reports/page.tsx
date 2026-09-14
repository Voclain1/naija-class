"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  formatCalendarDate,
  formatCalendarRange,
  REPORT_CARD_STATUS_KEYS,
  type CompletenessReportDto,
  type TeacherActivityReportDto,
} from "@school-kit/types";

import { ExportCsvButton } from "@/components/shared/export-csv-button";
import { InlineAlert } from "@/components/shared/inline-alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { getCompletenessReport, getTeacherActivityReport, ofCount } from "@/lib/reports/reports-api";

// Duplicated per-file rather than a shared hook — same pattern as the settings
// screens. See docs/deferred.md ("Shared usePermissions hook").
function hasPermission(permissions: string[], perm: string): boolean {
  return permissions.includes("*") || permissions.includes(perm);
}

const STATUS_LABELS: Record<(typeof REPORT_CARD_STATUS_KEYS)[number], string> = {
  DRAFT: "Draft",
  SUBJECT_REVIEWED: "Subjects reviewed",
  FORM_REVIEWED: "Awaiting principal",
  PRINCIPAL_APPROVED: "Approved",
  RELEASED: "Released",
};

// /reports — Phase 8 / CP2 Recording Completeness (docs/modules/phase-8.md §16).
//
// Shows whether records are getting in — never what they say. No marks, grades,
// averages or positions appear on this page, by design (§16.1).
//
// Every figure is "X of Y": a bare percentage of registers taken reads as an
// attendance rate, which it is not (§16 D33).
//
// The term comes from the admin topbar's selector (?termId=), like Insights;
// absent, the API uses the current term.
export default function ReportsPage() {
  const { permissions } = useAuth();
  const canRead = hasPermission(permissions, "reports.completeness.read");
  const canSeeTeachers = hasPermission(permissions, "reports.teacher-activity.read");
  const termId = useSearchParams().get("termId") ?? undefined;

  const [report, setReport] = useState<CompletenessReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await getCompletenessReport(termId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the report.");
    } finally {
      setLoading(false);
    }
  }, [termId]);

  useEffect(() => {
    if (canRead) void load();
  }, [canRead, load]);

  if (!canRead) {
    return (
      <div className="flex w-full max-w-5xl flex-col gap-4">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Reports</h1>
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          You don&apos;t have access to reports.
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Recording completeness</h1>
        <p className="text-sm text-muted-foreground">
          Are registers, scores and report cards getting in this term — and where aren&apos;t they? This page
          counts records, not results.
        </p>
      </header>

      {error && <InlineAlert action={{ label: "Try again", onClick: () => void load() }}>{error}</InlineAlert>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading report…
        </div>
      ) : report && !error ? (
        <>
          {report.health.length > 0 && (
            <section aria-labelledby="health-heading" className="flex flex-col gap-2">
              <h2 id="health-heading" className="font-serif text-xl font-medium text-foreground">
                Needs attention
              </h2>
              {report.health.map((h) => (
                <div
                  key={h.code}
                  role="status"
                  className="flex flex-col gap-1 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p>{h.message}</p>
                      {h.arms.length > 0 && <p className="mt-1 text-xs">{h.arms.join(", ")}</p>}
                    </div>
                  </div>
                  <Link href={h.href} className="shrink-0 font-medium underline">
                    Fix this
                  </Link>
                </div>
              ))}
            </section>
          )}

          {!report.term ? (
            <p className="text-sm text-muted-foreground">Set a current term to see this term&apos;s recording.</p>
          ) : (
            <Tabs defaultValue="school">
              <TabsList>
                <TabsTrigger value="school">Whole school</TabsTrigger>
                {canSeeTeachers && <TabsTrigger value="teachers">Teacher recording activity</TabsTrigger>}
              </TabsList>

              <TabsContent value="school" className="flex flex-col gap-8">
                <SchoolSections report={report} />
              </TabsContent>

              {canSeeTeachers && (
                // Radix mounts TabsContent only while its tab is selected, so the
                // audited fetch happens only when an admin opens this tab.
                <TabsContent value="teachers">
                  <TeacherActivityPanel termId={report.term.id} />
                </TabsContent>
              )}
            </Tabs>
          )}
        </>
      ) : null}
    </div>
  );
}

function SchoolSections({ report }: { report: CompletenessReportDto }) {
  const term = report.term!;
  const days = report.schoolDays!;
  const attendance = report.attendance!;
  const scores = report.scores!;
  const cards = report.reportCards!;
  const slug = `${term.name}-${term.academicYearLabel}`.replace(/[^\w-]+/g, "-").toLowerCase();

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {term.name} ({term.academicYearLabel}) · {formatCalendarRange(term.startDate, term.endDate)}
        {days.countedTo
          ? ` · counted up to ${formatCalendarDate(days.countedTo)}: ${days.schoolDayCount} school day${days.schoolDayCount === 1 ? "" : "s"}`
          : " · this term hasn't started, so nothing is expected yet"}
      </p>

      {days.excludedDays.length > 0 && (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">
            {days.excludedDays.length} weekday{days.excludedDays.length === 1 ? "" : "s"} not counted as school days
          </summary>
          <ul className="mt-2 list-disc pl-5">
            {days.excludedDays.map((x) => (
              <li key={x.date}>
                {formatCalendarDate(x.date)} — {x.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <section aria-labelledby="attendance-heading" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 id="attendance-heading" className="font-serif text-xl font-medium text-foreground">
            Daily registers
          </h2>
          <ExportCsvButton
            disabled={attendance.rows.length === 0}
            onExport={() =>
              exportRowsAsCsv(`registers-${slug}.csv`, attendance.rows, [
                { header: "Class", accessor: (r) => r.label },
                { header: "Level", accessor: (r) => r.classLevelName },
                { header: "Students enrolled", accessor: (r) => r.enrolledCount },
                { header: "Registers taken", accessor: (r) => r.registersTaken },
                { header: "Registers expected", accessor: (r) => r.registersExpected },
                { header: "Registers on non-school days", accessor: (r) => r.registersOnNonSchoolDays },
                { header: "Last register", accessor: (r) => r.lastRegisterDate },
              ])
            }
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {ofCount(attendance.totals.registersTaken, attendance.totals.registersExpected)} class registers taken. A
          register counts once per class per school day, whoever marks it.
        </p>
        {attendance.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No class has students enrolled in this term.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Students</TableHead>
                <TableHead className="text-right">Registers taken</TableHead>
                <TableHead>Last register</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attendance.rows.map((r) => (
                <TableRow key={r.groupId}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell className="text-right">{r.enrolledCount}</TableCell>
                  <TableCell className="text-right">
                    {ofCount(r.registersTaken, r.registersExpected)} school days
                    {r.registersOnNonSchoolDays > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        +{r.registersOnNonSchoolDays} on non-school days (not counted)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{r.lastRegisterDate ? formatCalendarDate(r.lastRegisterDate) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="scores-heading" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 id="scores-heading" className="font-serif text-xl font-medium text-foreground">
            Score entry
          </h2>
          <ExportCsvButton
            disabled={scores.rows.length === 0}
            onExport={() =>
              exportRowsAsCsv(`score-entry-${slug}.csv`, scores.rows, [
                { header: "Class", accessor: (r) => r.label },
                { header: "Subject", accessor: (r) => r.subjectName },
                { header: "Students enrolled", accessor: (r) => r.enrolledCount },
                { header: "Components", accessor: (r) => r.componentCount },
                { header: "Scores entered", accessor: (r) => r.slotsEntered },
                { header: "Scores expected", accessor: (r) => r.slotsExpected },
                { header: "Students signed off", accessor: (r) => r.studentsSignedOff },
                { header: "Students with any score", accessor: (r) => r.studentsWithScores },
              ])
            }
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {ofCount(scores.totals.slotsEntered, scores.totals.slotsExpected)} scores entered. Expected = students
          enrolled × grading components, for each subject a teacher is assigned to in that class.
        </p>
        {scores.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No subject teachers are assigned to classes with students this term.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead className="text-right">Scores entered</TableHead>
                <TableHead className="text-right">Signed off</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scores.rows.map((r) => (
                <TableRow key={`${r.groupId}-${r.subjectId}`}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell>{r.subjectName}</TableCell>
                  <TableCell className="text-right">{ofCount(r.slotsEntered, r.slotsExpected)}</TableCell>
                  <TableCell className="text-right">{ofCount(r.studentsSignedOff, r.studentsWithScores)} students</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {scores.unassigned.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Scores entered for subjects with no teacher assigned in that class (not counted above):{" "}
            {scores.unassigned.map((u) => `${u.label} · ${u.subjectName} (${u.slotsEntered})`).join("; ")}.
          </p>
        )}
      </section>

      <section aria-labelledby="cards-heading" className="flex flex-col gap-2">
        <h2 id="cards-heading" className="font-serif text-xl font-medium text-foreground">
          Report cards
        </h2>
        <p className="text-sm text-muted-foreground">
          This term: {cards.totals.byStatus.FORM_REVIEWED} awaiting principal approval, {cards.totals.byStatus.RELEASED}{" "}
          released, {cards.totals.studentsWithoutCard} students with no card yet. (The dashboard&apos;s approval count
          covers every term.)
        </p>
        {cards.rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class</TableHead>
                {REPORT_CARD_STATUS_KEYS.map((k) => (
                  <TableHead key={k} className="text-right">
                    {STATUS_LABELS[k]}
                  </TableHead>
                ))}
                <TableHead className="text-right">No card</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cards.rows.map((r) => (
                <TableRow key={r.groupId}>
                  <TableCell>{r.label}</TableCell>
                  {REPORT_CARD_STATUS_KEYS.map((k) => (
                    <TableCell key={k} className="text-right">
                      {r.byStatus[k]}
                    </TableCell>
                  ))}
                  <TableCell className="text-right">{r.studentsWithoutCard}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}

function TeacherActivityPanel({ termId }: { termId: string }) {
  const [data, setData] = useState<TeacherActivityReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every fetch writes an audit row (§3.4 D23). React StrictMode runs mount
  // effects twice in development; this ref keeps that to ONE request per open,
  // so the audit trail records views that happened, not a dev-mode artefact.
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    getTeacherActivityReport(termId)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load teacher activity."));
  }, [termId]);

  if (error) return <InlineAlert>{error}</InlineAlert>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        Recording activity only — what has been entered, not how students performed or how well anyone teaches.
        Registers are counted against the class, whoever marked them; &quot;keyed themselves&quot; shows what this
        teacher entered personally, since admins sometimes enter records for teachers.
      </p>
      {data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No staff hold the teacher role yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Teacher</TableHead>
              <TableHead>Form class</TableHead>
              <TableHead className="text-right">Form class registers</TableHead>
              <TableHead className="text-right">Registers keyed themselves</TableHead>
              <TableHead className="text-right">Scores on their subjects</TableHead>
              <TableHead className="text-right">Keyed themselves</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r) => (
              <TableRow key={r.userId}>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.formArms.length > 0 ? r.formArms.join(", ") : "—"}</TableCell>
                <TableCell className="text-right">
                  {r.formArms.length > 0 ? ofCount(r.formArmRegistersTaken, r.formArmRegistersExpected) : "—"}
                </TableCell>
                <TableCell className="text-right">{r.registersMarkedByThisPerson}</TableCell>
                <TableCell className="text-right">
                  {r.assignmentCount > 0 ? ofCount(r.assignedSlotsEntered, r.assignedSlotsExpected) : "No assignments"}
                </TableCell>
                <TableCell className="text-right">{r.assignedSlotsEnteredByThisPerson}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
