// CP6a D19 — unsaved marks that survive the two-minute staff lock.
//
// The problem: after more than two minutes in the background the session
// locks, every staff screen redirects to /unlock, and the mark sheet UNMOUNTS.
// Anything held in component state is gone. A teacher who typed 30 marks and
// switched to WhatsApp to check a script would come back to an empty sheet and
// no explanation.
//
// The answer is this module-level store, deliberately:
//
//   - IN MEMORY, with ONE exception. Nothing here is written to AsyncStorage,
//     and closing the app loses the draft; the screen says so while marks are
//     unsaved. The exception (owner's decision, 2026-10-14): when the SERVER
//     ends the session (a 401: expired, revoked, deactivated, suspended), the
//     drafts are stashed in SecureStore and given back when the same person
//     signs in again (draft-stash.ts). A teacher signed out mid-mark-sheet
//     through no act of their own should not lose the marks.
//
//   - KEYED BY PRINCIPAL. Every key starts with schoolId and userId, so a
//     different staff account on the same handset can never read another's
//     drafts, even before the wipe below runs.
//
//   - WIPED from memory at every principal boundary: sign-out, a 401 session
//     end (after stashing), and a fresh staff sign-in (session.tsx calls
//     clearAllGradebookDrafts). It is NOT wiped on lock — surviving the lock
//     is the entire point.
//
// No React import, so it stays testable under Vitest's node environment; the
// screen subscribes with useSyncExternalStore.

export interface DraftScope {
  schoolId: string;
  userId: string;
  termId: string;
  classArmId: string;
  subjectId: string;
}

type Cells = Readonly<Record<string, string>>;

const EMPTY: Cells = Object.freeze({});

let drafts = new Map<string, Cells>();
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * A number that changes whenever any draft changes — a stable
 * useSyncExternalStore snapshot for screens that derive from several keys.
 */
export function getGradebookDraftsVersion(): number {
  return version;
}

function columnPrefix(scope: DraftScope): string {
  return JSON.stringify([
    scope.schoolId,
    scope.userId,
    scope.termId,
    scope.classArmId,
    scope.subjectId,
  ]);
}

// Two kinds of draft share this store and the same principal keying: unsaved
// MARKS for one component, and unaccepted report-card COMMENTS for the column
// (CP6b). The kind is part of the key so the mark sheet's "which tests have
// unsaved marks" question cannot accidentally count a comment draft.
export function draftKey(scope: DraftScope, componentId: string): string {
  return columnPrefix(scope) + "|score:" + componentId;
}

/**
 * The "out of" a teacher chose for one component (pre-build audit, 2026-10-13,
 * phase-8.md D60). Stored beside the marks it gives meaning to, under its own
 * prefix so it never counts as an unsaved mark: one cell, "outOf", whose text
 * is the total ("" = marks in the component's own weight).
 */
export function outOfDraftKey(scope: DraftScope, componentId: string): string {
  return columnPrefix(scope) + "|out-of:" + componentId;
}

/** CP6b — unaccepted comment text, keyed by studentId within the column. */
export function commentDraftKey(scope: DraftScope): string {
  return columnPrefix(scope) + "|comment";
}

/**
 * CP7 — the form teacher's overall comment, keyed by studentId within a
 * (term, arm). No subject: this comment is about the child's whole term, so
 * its scope is one element shorter than a gradebook column's and cannot
 * collide with one.
 */
export function formCommentDraftKey(scope: {
  schoolId: string;
  userId: string;
  termId: string;
  classArmId: string;
}): string {
  return (
    JSON.stringify([scope.schoolId, scope.userId, scope.termId, scope.classArmId]) +
    "|form-comment"
  );
}

export function subscribeGradebookDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The unsaved cells for one component. Stable identity until it changes. */
export function readDraft(key: string): Cells {
  return drafts.get(key) ?? EMPTY;
}

export function setDraftCell(key: string, studentId: string, value: string): void {
  const next = { ...readDraft(key), [studentId]: value };
  drafts = new Map(drafts).set(key, next);
  emit();
}

/** Drop cells for the given students (after they were saved). */
export function clearDraftCells(key: string, studentIds: readonly string[]): void {
  const current = drafts.get(key);
  if (!current) return;
  const next: Record<string, string> = { ...current };
  for (const id of studentIds) delete next[id];
  const map = new Map(drafts);
  if (Object.keys(next).length === 0) map.delete(key);
  else map.set(key, next);
  drafts = map;
  emit();
}

/** Drop one component's draft entirely. */
export function clearDraft(key: string): void {
  if (!drafts.has(key)) return;
  const map = new Map(drafts);
  map.delete(key);
  drafts = map;
  emit();
}

/** Component ids in this column that still hold unsaved marks. */
export function componentsWithDrafts(scope: DraftScope): string[] {
  const prefix = columnPrefix(scope) + "|score:";
  const ids: string[] = [];
  for (const [key, cells] of drafts) {
    if (key.startsWith(prefix) && Object.keys(cells).length > 0) {
      ids.push(key.slice(prefix.length));
    }
  }
  return ids;
}

/** Whether the column holds any unaccepted comment text. */
export function hasCommentDrafts(scope: DraftScope): boolean {
  return Object.keys(readDraft(commentDraftKey(scope))).length > 0;
}

/** Whether a (school, user, term, arm, subject) column has any draft at all. */
export function columnHasDrafts(scope: DraftScope): boolean {
  return componentsWithDrafts(scope).length > 0 || hasCommentDrafts(scope);
}

/**
 * CP7 — unsaved lesson-note text, keyed by SECTION within one plan.
 *
 * D24: still in memory only, like every other draft here. A lesson note is far
 * longer than a mark or a comment, so losing one to an app kill costs more —
 * that is a known, accepted limit for the first pass, said plainly on screen,
 * and the thing to revisit first if teachers report lost work.
 */
export function lessonPlanDraftKey(scope: {
  schoolId: string;
  userId: string;
  lessonPlanId: string;
}): string {
  return (
    JSON.stringify([scope.schoolId, scope.userId, scope.lessonPlanId]) + "|lesson-plan"
  );
}

/**
 * Every draft, for the forced-sign-out stash (draft-stash.ts). A copy: the
 * caller cannot reach into the store through it.
 */
export function exportAllDrafts(): [string, Record<string, string>][] {
  return [...drafts].map(([key, cells]) => [key, { ...cells }]);
}

/**
 * Put stashed drafts back after the same person signs in again. Merged over
 * whatever is in memory, which a fresh sign-in has just emptied.
 */
export function importDrafts(entries: readonly [string, Record<string, string>][]): void {
  if (entries.length === 0) return;
  const map = new Map(drafts);
  for (const [key, cells] of entries) map.set(key, { ...(map.get(key) ?? {}), ...cells });
  drafts = map;
  emit();
}

/** Principal boundary: sign-out, session end, a new staff sign-in. */
export function clearAllGradebookDrafts(): void {
  if (drafts.size === 0) return;
  drafts = new Map();
  emit();
}
