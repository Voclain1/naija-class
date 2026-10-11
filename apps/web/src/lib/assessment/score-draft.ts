// Unsaved gradebook marks survive a forced sign-out (docs/deferred.md,
// "Forced session expiry still destroys unsaved gradebook work").
//
// While a column has unsaved edits, the typed cells are written to this tab's
// sessionStorage on every change. A forced sign-out tears the page down, but
// the login screen returns the teacher to the same column in the same tab, and
// the grid then offers the marks back. Nothing is saved for them: restoring
// puts the cells back as UNSAVED edits and the teacher presses Save, so the
// bulk endpoint's meaning of `entered_by`/`entered_at`, and the sign-off rule
// (any write clears it), are exactly what they were. That is why this is not
// autosave (docs/deferred-archive.md, "B — gradebook durability").
//
// What is stored: opaque student and component ids and the strings typed. No
// names. sessionStorage is per tab and gone when the tab closes; a deliberate
// sign-out clears every draft (clearAllScoreDrafts, called by logout); and a
// draft is keyed by the signed-in user, so whoever signs in next on that tab
// never sees another teacher's marks.

import type { ColumnOutOf, GradebookFormValues } from "@/components/teacher/gradebook/gradebook-form";

const KEY_PREFIX = "sk_gradebook_draft:";
// Long enough for any sitting; short enough that a stale tab doesn't offer
// marks from yesterday's lesson.
export const SCORE_DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface DraftCell {
  studentId: string;
  componentId: string;
  value: string;
}

export interface ScoreDraft {
  v: 1;
  savedAt: number;
  // The "Out of" each drafted column was typed against: a mark typed out of 60
  // means something else in a column now entered out of 40.
  outOf: Record<string, number | null>;
  cells: DraftCell[];
}

export interface DraftScope {
  userId: string;
  termId: string;
  classArmId: string;
  subjectId: string;
}

function keyFor(scope: DraftScope): string {
  return `${KEY_PREFIX}${scope.userId}:${scope.termId}:${scope.classArmId}:${scope.subjectId}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

// The cells whose typed value differs from what the column loaded with. Blank
// cells are left out: the bulk endpoint cannot unset a score, so a cleared
// cell has nothing to restore.
export function changedCells(values: GradebookFormValues, defaults: GradebookFormValues): DraftCell[] {
  const cells: DraftCell[] = [];
  values.rows.forEach((row, i) => {
    const before = defaults.rows[i];
    if (!before || before.studentId !== row.studentId) return;
    for (const [componentId, raw] of Object.entries(row.scores)) {
      const value = (raw ?? "").trim();
      if (value === "" || value === (before.scores[componentId] ?? "").trim()) continue;
      cells.push({ studentId: row.studentId, componentId, value });
    }
  });
  return cells;
}

export function writeScoreDraft(scope: DraftScope, cells: DraftCell[], outOf: ColumnOutOf, now = Date.now()): void {
  const store = storage();
  if (!store) return;
  try {
    if (cells.length === 0) {
      store.removeItem(keyFor(scope));
      return;
    }
    const used = new Set(cells.map((c) => c.componentId));
    const draft: ScoreDraft = {
      v: 1,
      savedAt: now,
      outOf: Object.fromEntries([...used].map((id) => [id, outOf[id] ?? null])),
      cells,
    };
    store.setItem(keyFor(scope), JSON.stringify(draft));
  } catch {
    // Quota or disabled storage: the grid still works, the safety net doesn't.
  }
}

export function readScoreDraft(scope: DraftScope, now = Date.now()): ScoreDraft | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(keyFor(scope));
    if (!raw) return null;
    const draft = JSON.parse(raw) as ScoreDraft;
    if (draft?.v !== 1 || !Array.isArray(draft.cells) || draft.cells.length === 0 || now - draft.savedAt > SCORE_DRAFT_MAX_AGE_MS) {
      store.removeItem(keyFor(scope));
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function clearScoreDraft(scope: DraftScope): void {
  try {
    storage()?.removeItem(keyFor(scope));
  } catch {
    // nothing to clear
  }
}

export function clearAllScoreDrafts(): void {
  const store = storage();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // nothing to clear
  }
}

// Which of a draft's cells can go back into the column as it is now. A cell
// comes back only when its student is still in the column, its component
// still exists, and its column is entered against the same "Out of" as when
// it was typed. `rowIndex` is the cell's row in the form.
export function restorableCells(
  draft: ScoreDraft,
  values: GradebookFormValues,
  outOf: ColumnOutOf,
): { cells: (DraftCell & { rowIndex: number })[]; skipped: number } {
  const rowIndex = new Map(values.rows.map((r, i) => [r.studentId, i]));
  const cells: (DraftCell & { rowIndex: number })[] = [];
  let skipped = 0;
  for (const cell of draft.cells) {
    const i = rowIndex.get(cell.studentId);
    const row = i === undefined ? undefined : values.rows[i];
    const sameUnits = (draft.outOf[cell.componentId] ?? null) === (outOf[cell.componentId] ?? null);
    if (i === undefined || !row || !(cell.componentId in row.scores) || !sameUnits) {
      skipped += 1;
      continue;
    }
    cells.push({ ...cell, rowIndex: i });
  }
  return { cells, skipped };
}
