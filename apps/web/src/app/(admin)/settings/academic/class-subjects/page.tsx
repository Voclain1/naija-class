"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ClassLevelDto,
  ClassSubjectDto,
  SubjectDto,
} from "@school-kit/types";

import {
  ClassSubjectMatrix,
  type CellSnapshot,
  type LevelDiff,
} from "@/components/settings/academic/class-subject-matrix";
import { MatrixDirtyProvider } from "@/components/settings/academic/matrix-dirty-context";
import { ApiError } from "@/lib/api-client";
import { listClassLevels } from "@/lib/class-levels/class-levels-api";
import {
  bulkUpdateClassSubjects,
  listClassSubjectsForLevel,
} from "@/lib/class-subjects/class-subjects-api";
import { listSubjects } from "@/lib/subjects/subjects-api";

// /settings/academic/class-subjects — the class-subject matrix.
//
// Architecture:
//   - This page owns the snapshot (the source of truth as last loaded
//     from the server) and the cross-cutting "dirty" signal that the
//     AcademicSubNav reads via MatrixDirtyContext.
//   - The matrix component owns the desired overlay and the cell
//     interaction logic.
//   - On save, the matrix computes per-level diffs and calls back into
//     this page's onPersistLevel handler, which POSTs to the /bulk
//     endpoint and returns the level's authoritative post-save rows.
//   - onLevelSaved merges those rows back into the snapshot so the
//     next render is consistent.
//
// Refresh-after-save: the /bulk response IS the post-save state. No
// extra GET round-trip needed. The browser-refresh "matrix persists"
// criterion is verified manually by reloading the page (which calls
// loadAll() afresh).
export default function ClassSubjectsMatrixPage() {
  const [levels, setLevels] = useState<ClassLevelDto[]>([]);
  const [subjects, setSubjects] = useState<SubjectDto[]>([]);
  const [snapshotByLevel, setSnapshotByLevel] = useState<
    Map<string, Map<string, CellSnapshot>>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lvls, subs] = await Promise.all([
        // Active-only here — inactive levels shouldn't pollute the matrix.
        // Admins who want to map curriculum to a deactivated level should
        // reactivate it first.
        listClassLevels({ includeInactive: false }),
        listSubjects({ includeInactive: false }),
      ]);
      const orderedLevels = [...lvls].sort(
        (a, b) => a.orderIndex - b.orderIndex || a.name.localeCompare(b.name),
      );
      const orderedSubjects = [...subs].sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      // Parallel listForLevel for every level — N round-trips for N levels,
      // but each is small (rows for one level only) and they share no
      // dependencies. For the 14-level Phase-1 spec target this is fine;
      // if the matrix ever needs to handle hundreds of levels, the API
      // can grow a "list all class_subjects for the school" endpoint.
      const perLevel = await Promise.all(
        orderedLevels.map(async (lvl) => ({
          levelId: lvl.id,
          rows: await listClassSubjectsForLevel(lvl.id),
        })),
      );

      const snap = new Map<string, Map<string, CellSnapshot>>();
      for (const { levelId, rows } of perLevel) {
        const inner = new Map<string, CellSnapshot>();
        for (const row of rows) {
          inner.set(row.subjectId, { linkId: row.id, isCore: row.isCore });
        }
        snap.set(levelId, inner);
      }

      setLevels(orderedLevels);
      setSubjects(orderedSubjects);
      setSnapshotByLevel(snap);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the matrix.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const onPersistLevel = useCallback(
    async (diff: LevelDiff): Promise<ClassSubjectDto[]> => {
      return bulkUpdateClassSubjects(diff.levelId, {
        create: diff.create.map((c) => ({
          subjectId: c.subjectId,
          isCore: c.isCore,
        })),
        delete: diff.deleteIds,
      });
    },
    [],
  );

  const onLevelSaved = useCallback(
    (levelId: string, rows: ClassSubjectDto[]) => {
      setSnapshotByLevel((prev) => {
        const next = new Map(prev);
        const inner = new Map<string, CellSnapshot>();
        for (const row of rows) {
          inner.set(row.subjectId, { linkId: row.id, isCore: row.isCore });
        }
        next.set(levelId, inner);
        return next;
      });
    },
    [],
  );

  const dirtyContextValue = useMemo(() => ({ isDirty }), [isDirty]);

  return (
    <MatrixDirtyProvider value={dirtyContextValue}>
      <div className="flex w-full flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            Class-subject matrix
          </h1>
          <p className="text-sm text-muted-foreground">
            Map each subject to the class levels that teach it. Click a cell
            to link or unlink; click the{" "}
            <span className="rounded bg-emerald-100 px-1 text-[10px] font-bold text-emerald-700">
              C
            </span>{" "}
            /{" "}
            <span className="rounded bg-sky-100 px-1 text-[10px] font-bold text-sky-700">
              E
            </span>{" "}
            pill on a linked cell to flip core / elective. Changes save
            one level row at a time, all-or-nothing per row.
          </p>
        </header>

        {loading ? (
          <MatrixSkeleton />
        ) : error ? (
          <div className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            <span>{error}</span>
            <button
              type="button"
              className="self-start text-xs underline"
              onClick={() => void loadAll()}
            >
              Try again
            </button>
          </div>
        ) : subjects.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm">
            <p className="mb-3 text-muted-foreground">
              No subjects yet. Add at least one in the Subjects tab before
              you can build the matrix.
            </p>
            <Link
              href="/settings/academic/subjects"
              className="text-foreground underline"
            >
              Go to Subjects →
            </Link>
          </div>
        ) : (
          <ClassSubjectMatrix
            levels={levels}
            subjects={subjects}
            snapshotByLevel={snapshotByLevel}
            onPersistLevel={onPersistLevel}
            onDirtyChange={setIsDirty}
            onLevelSaved={onLevelSaved}
          />
        )}
      </div>
    </MatrixDirtyProvider>
  );
}

function MatrixSkeleton() {
  return (
    <div className="rounded-md border">
      <div className="border-b bg-muted/50 p-3">
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex gap-2 border-b p-3 last:border-b-0">
          <div className="h-6 w-32 animate-pulse rounded bg-muted" />
          {Array.from({ length: 5 }).map((_, j) => (
            <div
              key={j}
              className="h-6 w-10 animate-pulse rounded bg-muted/70"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
