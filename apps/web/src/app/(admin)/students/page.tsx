"use client";

import { Camera, ChevronDown, FileUp, Loader2, Rows3, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type {
  ClassArmDto,
  StudentDto,
  StudentStatusDto,
} from "@school-kit/types";

import { ExportCsvButton } from "@/components/shared/export-csv-button";
import { PrerequisiteNotice } from "@/components/setup/prerequisite-notice";
import { PrintButton } from "@/components/shared/print-button";
import { StudentsListControls } from "@/components/students/students-list-controls";
import { StudentsRosterTable } from "@/components/students/students-roster-table";
import { Button } from "@/components/ui/button";
import { Appear, EmptyState, PageHeader, PageSkeleton } from "@/components/layout/page-primitives";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError } from "@/lib/api-client";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { listStudents } from "@/lib/students/students-api";
import { exportRowsAsCsv, type CsvColumn } from "@/lib/csv-export";

// Export reuses the same GET /students query the page already runs (same
// filters, same permission) — it just loops the cursor at the endpoint's max
// page size (200) instead of stopping after one page like "Load more" does.
// Capped at 100 pages (20,000 students) purely as a runaway-loop guard; no
// real school roster gets remotely close to that.
const STUDENT_EXPORT_COLUMNS: CsvColumn<StudentDto>[] = [
  { header: "Admission Number", accessor: (s) => s.admissionNumber },
  { header: "Last Name", accessor: (s) => s.lastName },
  { header: "First Name", accessor: (s) => s.firstName },
  { header: "Middle Name", accessor: (s) => s.middleName },
  { header: "Gender", accessor: (s) => s.gender },
  { header: "Date of Birth", accessor: (s) => String(s.dateOfBirth).slice(0, 10) },
  {
    header: "Class",
    accessor: (s) =>
      s.currentEnrollment
        ? `${s.currentEnrollment.classArm.classLevel.name} ${s.currentEnrollment.classArm.name}`
        : "",
  },
  { header: "Status", accessor: (s) => s.status },
  { header: "Phone", accessor: (s) => s.phone },
  { header: "Email", accessor: (s) => s.email },
  { header: "Admitted At", accessor: (s) => String(s.admittedAt).slice(0, 10) },
];

// /students — Phase 1 / Slice 4 cp3.
//
// Cursor pagination: the cp2 service returns `meta.cursor` (a Student id)
// when more rows exist beyond `limit`. We expose this as a "Load more"
// button — simplest UX for a one-direction cursor, and keeps the URL clean.
//
// Sort note: rows arrive ordered by `id ASC` from the API (see comment in
// students.service.ts on why `id` rather than (lastName, firstName)). The
// table renders in arrival order; admins typically discover students via
// search or the admission-number column rather than alphabetical scroll.
//
// Slice 9 wired the `classArmId` filter into the UI — joins through
// current-term enrollment so picking a class shows that arm's roster for
// the current term. `academicYearId` remains accepted-but-unused at the
// API layer; no UI surface yet.
export default function StudentsRosterPage() {
  const [students, setStudents] = useState<StudentDto[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StudentStatusDto | "">("");
  const [classArmId, setClassArmId] = useState("");
  const [arms, setArms] = useState<ClassArmDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load arms once for the filter dropdown.
  useEffect(() => {
    void (async () => {
      try {
        const list = await listClassArms();
        setArms(list.filter((a) => a.isActive));
      } catch {
        // Silent — filter just shows "All classes".
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listStudents({
        search: search || undefined,
        status: status || undefined,
        classArmId: classArmId || undefined,
      });
      setStudents(res.data);
      setCursor(res.meta.cursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load students.");
    } finally {
      setLoading(false);
    }
  }, [search, status, classArmId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onLoadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await listStudents({
        search: search || undefined,
        status: status || undefined,
        classArmId: classArmId || undefined,
        cursor,
      });
      setStudents((prev) => [...prev, ...res.data]);
      setCursor(res.meta.cursor);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not load more students.",
      );
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, search, status, classArmId]);

  const onExport = useCallback(async () => {
    const rows: StudentDto[] = [];
    let exportCursor: string | undefined;
    let pages = 0;
    do {
      const res = await listStudents({
        search: search || undefined,
        status: status || undefined,
        classArmId: classArmId || undefined,
        cursor: exportCursor,
        limit: 200,
      });
      rows.push(...res.data);
      exportCursor = res.meta.cursor;
      pages += 1;
    } while (exportCursor && pages < 100);
    exportRowsAsCsv("students.csv", rows, STUDENT_EXPORT_COLUMNS);
  }, [search, status, classArmId]);

  // max-w-7xl, wider than the 5xl reading pages use: this one is a TABLE, and
  // at a real roster size the old cap left a third of a 1440px screen empty
  // while the names and classes were squeezed. Data pages get the width they
  // need; prose pages keep the narrower measure.
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        title="Students"
        subtitle={
          <span className="print:hidden">
            Your school&apos;s roster. Add students one at a time, in a grid, or by importing a CSV.
          </span>
        }
        actions={
          /* Toolbar (rearranged 2026-08-18). Five same-weight buttons wrapped
             onto two ragged rows and gave the page two competing primaries.
             Now: the roster's own utilities (Export, Print) sit together on the
             left as small outline buttons, and every way of ADDING a student
             collapses into one primary split button — click it for the common
             case (one student), open the caret for the grid and the CSV import.
             One primary action, one row, at any width. */
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <div className="flex items-center gap-2">
              <ExportCsvButton onExport={onExport} disabled={students.length === 0} />
              <PrintButton />
            </div>

          <div className="flex items-center">
            <Button asChild size="sm" className="rounded-r-none">
              <Link href="/students/new">
                <UserPlus className="h-4 w-4" />
                Add student
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  aria-label="More ways to add students"
                  className="rounded-l-none border-l border-primary-foreground/25 px-2"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem asChild>
                  <Link href="/students/new/bulk">
                    <Rows3 className="mr-2 h-4 w-4" />
                    <span className="flex flex-col">
                      <span>Add several in a grid</span>
                      <span className="text-xs text-muted-foreground">
                        Type or paste a row per student
                      </span>
                    </span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/students/import">
                    <FileUp className="mr-2 h-4 w-4" />
                    <span className="flex flex-col">
                      <span>Import from CSV</span>
                      <span className="text-xs text-muted-foreground">
                        Upload a whole roster file
                      </span>
                    </span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/students/scan">
                    <Camera className="mr-2 h-4 w-4" />
                    <span className="flex flex-col">
                      <span>Scan a student list</span>
                      <span className="text-xs text-muted-foreground">
                        Photograph a register page
                      </span>
                    </span>
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        }
      />

      {/* The handover this product was missing. Building a roster feels like
          the finish line, but a student on this page is in no class, on no
          register and on no invoice until they are enrolled. `onlyAfter`
          holds this back until there is actually a roster — on an empty
          Students page it would be noise, and the page's own empty state
          already says what to do. */}
      <div className="print:hidden">
        <PrerequisiteNotice
          stepKey="enrollments"
          onlyAfter="students"
          because="Your students are on the roster but not yet in any class."
        />
      </div>

      <div className="print:hidden">
        <StudentsListControls
          search={search}
          status={status}
          classArmId={classArmId}
          arms={arms}
          onSearchChange={setSearch}
          onStatusChange={setStatus}
          onClassArmChange={setClassArmId}
        />
      </div>

      {loading ? (
        <PageSkeleton rows={6} />
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : students.length === 0 ? (
        <EmptyState
          title={search || status || classArmId ? "No students match those filters." : "No students yet."}
          body={
            search || status || classArmId
              ? "Try clearing the search, status, or class filter."
              : "Add your first student — or import a roster from CSV."
          }
          action={
            /* The empty state is the one place all three routes stay visible
               side by side — a school with no students yet is choosing an
               intake method, not repeating a habit, so hiding two of them
               behind a caret here would be the wrong trade. */
            !search && !status && !classArmId ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild>
                  <Link href="/students/new">
                    <UserPlus className="mr-1 h-4 w-4" />
                    Add student
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/students/new/bulk">
                    <Rows3 className="mr-1 h-4 w-4" />
                    Add several in a grid
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/students/import">
                    <FileUp className="mr-1 h-4 w-4" />
                    Import from CSV
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/students/scan">
                    <Camera className="mr-1 h-4 w-4" />
                    Scan a student list
                  </Link>
                </Button>
              </div>
            ) : null
          }
        />
      ) : (
        <>
          {/* The table fades in where the skeleton was — not each row in turn.
              See Appear's own comment on why a staggered list is the thing D5
              rules out. */}
          <Appear>
            <StudentsRosterTable students={students} />
          </Appear>
          {cursor && (
            <div className="flex justify-center print:hidden">
              <Button
                type="button"
                variant="outline"
                onClick={onLoadMore}
                disabled={loadingMore}
              >
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
          <p className="text-center text-xs text-muted-foreground print:hidden">
            {students.length} {students.length === 1 ? "student" : "students"}
            {cursor ? " · more available" : ""}
          </p>
        </>
      )}
    </div>
  );
}
