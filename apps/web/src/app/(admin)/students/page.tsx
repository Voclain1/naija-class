"use client";

import { FileUp, Loader2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type {
  ClassArmDto,
  StudentDto,
  StudentStatusDto,
} from "@school-kit/types";

import { StudentsListControls } from "@/components/students/students-list-controls";
import { StudentsRosterTable } from "@/components/students/students-roster-table";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { listStudents } from "@/lib/students/students-api";

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

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
          <p className="text-sm text-muted-foreground">
            Your school&apos;s roster. Add students one-by-one or import them
            in bulk from a CSV.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/students/import">
              <FileUp className="mr-1 h-4 w-4" />
              Import students
            </Link>
          </Button>
          <Button asChild>
            <Link href="/students/new">
              <UserPlus className="mr-1 h-4 w-4" />
              Add student
            </Link>
          </Button>
        </div>
      </header>

      <StudentsListControls
        search={search}
        status={status}
        classArmId={classArmId}
        arms={arms}
        onSearchChange={setSearch}
        onStatusChange={setStatus}
        onClassArmChange={setClassArmId}
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : students.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed bg-muted/30 p-8 text-center">
          <p className="text-sm font-medium">
            {search || status || classArmId
              ? "No students match those filters."
              : "No students yet."}
          </p>
          <p className="text-sm text-muted-foreground">
            {search || status || classArmId
              ? "Try clearing the search, status, or class filter."
              : "Add your first student — or import a roster from CSV."}
          </p>
          {!search && !status && !classArmId && (
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Button asChild variant="outline">
                <Link href="/students/import">
                  <FileUp className="mr-1 h-4 w-4" />
                  Import students
                </Link>
              </Button>
              <Button asChild>
                <Link href="/students/new">
                  <UserPlus className="mr-1 h-4 w-4" />
                  Add student
                </Link>
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <StudentsRosterTable students={students} />
          {cursor && (
            <div className="flex justify-center">
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
          <p className="text-center text-xs text-muted-foreground">
            {students.length} {students.length === 1 ? "student" : "students"}
            {cursor ? " · more available" : ""}
          </p>
        </>
      )}
    </div>
  );
}
