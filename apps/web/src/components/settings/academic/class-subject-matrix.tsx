"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ClassLevelDto,
  ClassSubjectDto,
  SubjectDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";

// Per-cell server snapshot — null when no link exists for (level, subject).
export type CellSnapshot = { linkId: string; isCore: boolean } | null;

// Per-cell user intent — only present in `desired` when the user has
// touched the cell since the last save. Absence means "render whatever
// the snapshot says."
type CellDesired = { linked: true; isCore: boolean } | { linked: false };

// One save unit — what the matrix sends to the page per dirty level row.
export interface LevelDiff {
  levelId: string;
  create: { subjectId: string; isCore: boolean }[];
  deleteIds: string[];
}

interface Props {
  levels: ClassLevelDto[]; // expected ordered by orderIndex then name
  subjects: SubjectDto[]; // expected ordered by name
  snapshotByLevel: Map<string, Map<string, CellSnapshot>>;
  /** Called once per dirty level on Save. Sequential — the matrix awaits
   *  each call before the next. Should perform the /bulk request and
   *  return the level's authoritative post-save rows so the matrix can
   *  update its snapshot slice. Throwing aborts the remaining saves. */
  onPersistLevel: (diff: LevelDiff) => Promise<ClassSubjectDto[]>;
  /** Mirrors back to the parent so it can update an "unsaved changes"
   *  signal (e.g. for the sub-nav dirty context). */
  onDirtyChange: (isDirty: boolean) => void;
  /** Lets the parent fold the level's authoritative post-save rows back
   *  into its snapshot. */
  onLevelSaved: (levelId: string, rows: ClassSubjectDto[]) => void;
}

// The matrix is a controlled component on `snapshotByLevel`, but owns its
// own `desired` overlay map. After a successful save for a level, the
// overlay entries for that level are cleared and the parent's snapshot is
// updated via onLevelSaved — the next render sees a coherent post-save
// view from the snapshot alone.
export function ClassSubjectMatrix({
  levels,
  subjects,
  snapshotByLevel,
  onPersistLevel,
  onDirtyChange,
  onLevelSaved,
}: Props) {
  const [desired, setDesired] = useState<Map<string, Map<string, CellDesired>>>(
    new Map(),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // helpers
  // -----------------------------------------------------------------------

  const getSnapshot = useCallback(
    (levelId: string, subjectId: string): CellSnapshot => {
      return snapshotByLevel.get(levelId)?.get(subjectId) ?? null;
    },
    [snapshotByLevel],
  );

  const getDesired = useCallback(
    (levelId: string, subjectId: string): CellDesired | undefined => {
      return desired.get(levelId)?.get(subjectId);
    },
    [desired],
  );

  const getEffective = useCallback(
    (levelId: string, subjectId: string): CellDesired => {
      const d = getDesired(levelId, subjectId);
      if (d) return d;
      const snap = getSnapshot(levelId, subjectId);
      if (snap) return { linked: true, isCore: snap.isCore };
      return { linked: false };
    },
    [getDesired, getSnapshot],
  );

  const isCellDirty = useCallback(
    (levelId: string, subjectId: string): boolean => {
      const d = getDesired(levelId, subjectId);
      if (!d) return false;
      const snap = getSnapshot(levelId, subjectId);
      if (!snap && !d.linked) return false; // touched then untouched
      if (snap && d.linked && snap.isCore === d.isCore) return false; // no-op
      return true;
    },
    [getDesired, getSnapshot],
  );

  // -----------------------------------------------------------------------
  // dirty signal
  // -----------------------------------------------------------------------

  const dirtyLevelIds = useMemo(() => {
    const set = new Set<string>();
    for (const [levelId, perSubject] of desired) {
      for (const subjectId of perSubject.keys()) {
        if (isCellDirty(levelId, subjectId)) {
          set.add(levelId);
          break;
        }
      }
    }
    return set;
  }, [desired, isCellDirty]);

  const isDirty = dirtyLevelIds.size > 0;

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  // beforeunload: catches close/refresh/URL-bar navigation. In-app sibling
  // tab navigation is guarded separately by the sub-nav reading
  // useMatrixDirty(). Sidebar / top-nav are NOT guarded — Phase-1
  // documented trade-off (see docs/deferred.md).
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // -----------------------------------------------------------------------
  // interactions
  // -----------------------------------------------------------------------

  const toggleLink = useCallback(
    (levelId: string, subjectId: string, subjectDefaultCore: boolean) => {
      setDesired((prev) => {
        const next = new Map(prev);
        const perSubject = new Map(next.get(levelId) ?? new Map());
        const current = getEffective(levelId, subjectId);
        if (current.linked) {
          perSubject.set(subjectId, { linked: false });
        } else {
          // New link defaults to the subject's own category. ELECTIVE /
          // VOCATIONAL subjects default to non-core; CORE subjects to core.
          perSubject.set(subjectId, {
            linked: true,
            isCore: subjectDefaultCore,
          });
        }
        next.set(levelId, perSubject as Map<string, CellDesired>);
        return next;
      });
      setSaveError(null);
    },
    [getEffective],
  );

  const toggleCore = useCallback(
    (levelId: string, subjectId: string) => {
      setDesired((prev) => {
        const next = new Map(prev);
        const perSubject = new Map(next.get(levelId) ?? new Map());
        const current = getEffective(levelId, subjectId);
        if (!current.linked) return prev; // can't flip core on an unlinked cell
        perSubject.set(subjectId, { linked: true, isCore: !current.isCore });
        next.set(levelId, perSubject as Map<string, CellDesired>);
        return next;
      });
      setSaveError(null);
    },
    [getEffective],
  );

  const discard = useCallback(() => {
    setDesired(new Map());
    setSaveError(null);
  }, []);

  // -----------------------------------------------------------------------
  // save
  // -----------------------------------------------------------------------

  const computeDiff = useCallback(
    (levelId: string): LevelDiff => {
      const create: { subjectId: string; isCore: boolean }[] = [];
      const deleteIds: string[] = [];
      const perSubject = desired.get(levelId);
      if (!perSubject) return { levelId, create, deleteIds };

      for (const [subjectId, d] of perSubject) {
        if (!isCellDirty(levelId, subjectId)) continue;
        const snap = getSnapshot(levelId, subjectId);
        if (!snap && d.linked) {
          create.push({ subjectId, isCore: d.isCore });
        } else if (snap && !d.linked) {
          deleteIds.push(snap.linkId);
        } else if (snap && d.linked && snap.isCore !== d.isCore) {
          // Core/elective flip on an existing link — delete the old row and
          // create a fresh one in the same /bulk transaction. The cp2
          // service processes deletes BEFORE creates so the unique
          // (school_id, class_level_id, subject_id) constraint isn't
          // violated mid-transaction.
          deleteIds.push(snap.linkId);
          create.push({ subjectId, isCore: d.isCore });
        }
      }
      return { levelId, create, deleteIds };
    },
    [desired, getSnapshot, isCellDirty],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    const total = dirtyLevelIds.size;
    let saved = 0;
    let failed = false;
    for (const levelId of dirtyLevelIds) {
      const diff = computeDiff(levelId);
      if (diff.create.length === 0 && diff.deleteIds.length === 0) {
        // Shouldn't happen — dirtyLevelIds gates on isCellDirty — but be
        // defensive against accidental no-ops to keep the audit log clean.
        continue;
      }
      try {
        const rows = await onPersistLevel(diff);
        onLevelSaved(levelId, rows);
        // Clear the desired overlay for this level — the next render will
        // read directly from the freshly-merged snapshot.
        setDesired((prev) => {
          if (!prev.has(levelId)) return prev;
          const next = new Map(prev);
          next.delete(levelId);
          return next;
        });
        saved += 1;
      } catch (e) {
        failed = true;
        const message = e instanceof Error ? e.message : "Save failed.";
        setSaveError(
          total > 1
            ? `${saved} of ${total} rows saved. Retry to save the rest: ${message}`
            : message,
        );
        break;
      }
    }
    setSaving(false);
    return !failed;
  }, [computeDiff, dirtyLevelIds, onLevelSaved, onPersistLevel]);

  // -----------------------------------------------------------------------
  // render
  // -----------------------------------------------------------------------

  if (subjects.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No subjects yet. Add some in the Subjects tab before mapping them to
        class levels.
      </p>
    );
  }

  if (levels.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No class levels found.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-auto rounded-md border">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 min-w-[160px] border-b border-r bg-muted/50 px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                Class level \ Subject
              </th>
              {subjects.map((s) => (
                <th
                  key={s.id}
                  className="sticky top-0 z-10 h-32 min-w-[44px] border-b bg-muted/50 px-1 align-bottom text-xs font-medium"
                  scope="col"
                >
                  <div className="flex h-full items-end justify-center">
                    <span className="origin-bottom-left -translate-y-1 translate-x-3 rotate-[-60deg] whitespace-nowrap">
                      {s.name}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {levels.map((level) => (
              <tr key={level.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 min-w-[160px] border-r bg-card px-3 py-2 text-left font-medium"
                >
                  <span className="block">{level.name}</span>
                  {isCellAnyDirtyForLevel(level.id, desired, isCellDirty) && (
                    <span className="block text-xs font-normal text-amber-600">
                      unsaved
                    </span>
                  )}
                </th>
                {subjects.map((subj) => (
                  <MatrixCell
                    key={subj.id}
                    levelId={level.id}
                    subjectId={subj.id}
                    state={getEffective(level.id, subj.id)}
                    dirty={isCellDirty(level.id, subj.id)}
                    subjectDefaultCore={subj.category === "CORE"}
                    onToggleLink={toggleLink}
                    onToggleCore={toggleCore}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {saveError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {saveError}
        </div>
      )}

      {isDirty && (
        <div className="sticky bottom-4 flex items-center justify-between rounded-md border bg-card p-3 shadow-md">
          <p className="text-sm">
            <span className="font-medium">{dirtyLevelIds.size}</span>{" "}
            {dirtyLevelIds.size === 1 ? "row has" : "rows have"} unsaved
            changes.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={discard}
              disabled={saving}
            >
              Discard
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------
// MatrixCell — single tappable cell with optional core/elective pill
// -------------------------------------------------------------------------

interface CellProps {
  levelId: string;
  subjectId: string;
  state: CellDesired;
  dirty: boolean;
  subjectDefaultCore: boolean;
  onToggleLink: (
    levelId: string,
    subjectId: string,
    subjectDefaultCore: boolean,
  ) => void;
  onToggleCore: (levelId: string, subjectId: string) => void;
}

function MatrixCell({
  levelId,
  subjectId,
  state,
  dirty,
  subjectDefaultCore,
  onToggleLink,
  onToggleCore,
}: CellProps) {
  // The cell itself is a clickable <div role="button"> (not a <button>)
  // because the C/E core/elective pill nested inside is a real <button>,
  // and nesting interactive elements inside <button> is invalid HTML.
  const baseClasses =
    "flex h-9 min-w-[44px] cursor-pointer items-center justify-center border-b border-l text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-inset";

  let fillClasses = "bg-card text-muted-foreground hover:bg-muted/50";
  if (state.linked) {
    fillClasses = state.isCore
      ? "bg-emerald-600 text-white hover:bg-emerald-700"
      : "bg-sky-600 text-white hover:bg-sky-700";
  }
  const dirtyBorder = dirty ? "ring-2 ring-amber-400 ring-inset" : "";

  return (
    <td className="p-0">
      <div
        role="button"
        tabIndex={0}
        className={`${baseClasses} ${fillClasses} ${dirtyBorder} w-full`}
        aria-label={
          state.linked
            ? `Unlink subject from level (currently ${state.isCore ? "core" : "elective"})`
            : "Link subject to level"
        }
        onClick={() => onToggleLink(levelId, subjectId, subjectDefaultCore)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleLink(levelId, subjectId, subjectDefaultCore);
          }
        }}
      >
        {state.linked ? (
          <button
            type="button"
            aria-label={`Toggle ${state.isCore ? "core to elective" : "elective to core"}`}
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide focus:outline-none focus:ring-2 focus:ring-white ${
              state.isCore
                ? "bg-emerald-800/40 text-white hover:bg-emerald-900/60"
                : "bg-sky-800/40 text-white hover:bg-sky-900/60"
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCore(levelId, subjectId);
            }}
          >
            {state.isCore ? "C" : "E"}
          </button>
        ) : (
          <span aria-hidden className="opacity-30">
            ·
          </span>
        )}
      </div>
    </td>
  );
}

function isCellAnyDirtyForLevel(
  levelId: string,
  desired: Map<string, Map<string, CellDesired>>,
  isCellDirty: (levelId: string, subjectId: string) => boolean,
): boolean {
  const perSubject = desired.get(levelId);
  if (!perSubject) return false;
  for (const subjectId of perSubject.keys()) {
    if (isCellDirty(levelId, subjectId)) return true;
  }
  return false;
}
