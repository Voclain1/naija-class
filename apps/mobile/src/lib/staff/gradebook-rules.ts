import {
  MAX_RAW_OUT_OF,
  type AssessmentFeedResponse,
  type AssessmentFeedRowDto,
  type GradingComponentDto,
} from "@school-kit/types";

// Pure rules behind the CP6a mark sheet. They mirror the web teacher
// gradebook (apps/web/src/components/teacher/gradebook/gradebook-form.ts) so
// the two surfaces agree on what a valid mark, a complete column and a
// signed-off column are. The server remains the authority on every one of
// them; these exist so the phone can explain a problem before sending it.
//
// The phone enters ONE component at a time (D18), so the unit of work here is
// a component's worth of cells, keyed by studentId, holding the raw text typed.

/** Unsaved text per student for one component. Empty string = cleared. */
export type ComponentDraft = Readonly<Record<string, string>>;

/**
 * Per-cell rule, same as web: empty is "unentered" (valid), otherwise a whole
 * number in 0..max, where max is the component's weight or the "out of" the
 * teacher chose. Returns a short message or null.
 */
export function cellError(value: string, max: number): string | null {
  const v = value.trim();
  if (v === "") return null;
  if (!/^\d+$/.test(v)) return "Whole number, 0–" + max;
  if (Number(v) > max) return "Maximum is " + max;
  return null;
}

/** The saved score for one student and component, or null if none. */
export function savedScore(row: AssessmentFeedRowDto, componentId: string): number | null {
  return row.scores.find((s) => s.componentId === componentId)?.score ?? null;
}

// ---- Marks "out of" any total (phase-8.md D60; on the web since CP5a, in
// the app since the pre-build audit, 2026-10-13). The SERVER scales: the app
// sends the raw mark and its total and shows the server's preview.

/** A typed "out of": null for blank (marks in weight units), or why it is not usable. */
export function parseOutOf(text: string): { outOf: number | null; error: string | null } {
  const v = text.trim();
  if (v === "") return { outOf: null, error: null };
  if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > MAX_RAW_OUT_OF) {
    return { outOf: null, error: `A whole number from 1 to ${MAX_RAW_OUT_OF}` };
  }
  return { outOf: Number(v), error: null };
}

/**
 * The total a component's saved marks were entered out of, when every saved
 * mark shares one. Same rule as the web: the column reopens in that total,
 * with the marks as they were typed.
 */
export function sharedSavedOutOf(rows: readonly AssessmentFeedRowDto[], componentId: string): number | null {
  let shared: number | null = null;
  for (const row of rows) {
    const s = row.scores.find((x) => x.componentId === componentId);
    if (!s) continue;
    if (s.rawOutOf === null || s.rawScore === null) return null;
    if (shared === null) shared = s.rawOutOf;
    else if (shared !== s.rawOutOf) return null;
  }
  return shared;
}

/**
 * What a cell shows when nothing is typed in it. In weight units, the saved
 * score. Out of a total, the saved raw mark when it was saved in that same
 * total; otherwise blank, with the saved mark shown beside it (savedNote).
 */
export function savedCellText(row: AssessmentFeedRowDto, componentId: string, outOf: number | null): string {
  const s = row.scores.find((x) => x.componentId === componentId);
  if (!s) return "";
  if (outOf === null) return String(s.score);
  return s.rawOutOf === outOf && s.rawScore !== null ? String(s.rawScore) : "";
}

/** "Saved 22/60" (and "as 37/100" when it was typed out of a total). */
export function savedNote(row: AssessmentFeedRowDto, component: Pick<GradingComponentDto, "id" | "weight">): string | null {
  const s = row.scores.find((x) => x.componentId === component.id);
  if (!s) return null;
  const typed = s.rawOutOf !== null && s.rawScore !== null ? ` (typed ${s.rawScore}/${s.rawOutOf})` : "";
  return `Saved ${s.score}/${component.weight}${typed}`;
}

// D21. The bulk endpoint is an upsert with no delete, so an emptied cell that
// already holds a saved mark would look cleared and quietly stay saved.
export const CANNOT_REMOVE_MESSAGE = "Saved marks can be changed but not removed.";

/** One cell to save: a score in weight units, or a raw mark the server scales. */
export type ScoreRow =
  | { studentId: string; componentId: string; score: number }
  | { studentId: string; componentId: string; raw: { mark: number; outOf: number } };

export interface ComponentSaveSet {
  /** Rows to send, sorted by studentId so a server issue path maps back. */
  rows: ScoreRow[];
  /** Students whose draft differs from what is saved (includes invalid ones). */
  dirtyStudentIds: string[];
  /** studentId → message for cells that must be fixed before saving. */
  errors: Record<string, string>;
}

/**
 * Turn one component's draft into a save. A draft cell counts only when it
 * differs from the saved mark; an untouched or unchanged cell is never sent,
 * which matches web's dirty-cells-only rule and avoids rewriting enteredBy on
 * marks this teacher did not change.
 */
export function collectComponentSave(
  feedRows: readonly AssessmentFeedRowDto[],
  component: Pick<GradingComponentDto, "id" | "weight">,
  draft: ComponentDraft,
  outOf: number | null = null,
): ComponentSaveSet {
  const rows: ComponentSaveSet["rows"] = [];
  const dirtyStudentIds: string[] = [];
  const errors: Record<string, string> = {};

  for (const row of feedRows) {
    const studentId = row.student.id;
    const raw = draft[studentId];
    if (raw === undefined) continue;
    const text = raw.trim();
    const saved = savedScore(row, component.id);

    if (text === "") {
      if (saved !== null) {
        dirtyStudentIds.push(studentId);
        errors[studentId] = CANNOT_REMOVE_MESSAGE;
      }
      continue;
    }

    const error = cellError(text, outOf ?? component.weight);
    if (error) {
      dirtyStudentIds.push(studentId);
      errors[studentId] = error;
      continue;
    }

    const mark = Number(text);
    if (outOf === null) {
      if (saved === mark) continue;
      dirtyStudentIds.push(studentId);
      rows.push({ studentId, componentId: component.id, score: mark });
      continue;
    }
    // Out of a total: unchanged only if it was saved as this same raw mark.
    if (savedCellText(row, component.id, outOf) === String(mark)) continue;
    dirtyStudentIds.push(studentId);
    rows.push({ studentId, componentId: component.id, raw: { mark, outOf } });
  }

  rows.sort((a, b) => a.studentId.localeCompare(b.studentId));
  return { rows, dirtyStudentIds, errors };
}

/**
 * Bind a 400's `details.issues` back to students. The server reports
 * `path: ["rows", i, ...]` against the array it was sent, so the caller passes
 * that same array.
 */
export function issuesByStudent(
  details: unknown,
  sentRows: readonly { studentId: string }[],
): Record<string, string> {
  const issues = (details as { issues?: { path?: unknown; message?: unknown }[] } | undefined)
    ?.issues;
  const bound: Record<string, string> = {};
  if (!Array.isArray(issues)) return bound;
  for (const issue of issues) {
    const path = issue.path;
    if (!Array.isArray(path) || path[0] !== "rows" || typeof path[1] !== "number") continue;
    const row = sentRows[path[1]];
    if (!row) continue;
    bound[row.studentId] = typeof issue.message === "string" ? issue.message : "Not accepted";
  }
  return bound;
}

/** Every enrolled student has a saved score for every component. */
export function isColumnFullyScored(
  feed: AssessmentFeedResponse,
  components: readonly Pick<GradingComponentDto, "id">[],
): boolean {
  if (feed.data.length === 0 || components.length === 0) return false;
  return feed.data.every((row) => {
    const scored = new Set(row.scores.map((s) => s.componentId));
    return components.every((c) => scored.has(c.id));
  });
}

/** How many students have a saved score for this component. */
export function componentProgress(
  feed: AssessmentFeedResponse,
  componentId: string,
): { scored: number; total: number } {
  const scored = feed.data.filter((row) => savedScore(row, componentId) !== null).length;
  return { scored, total: feed.data.length };
}

/**
 * The column is signed off when EVERY student's summary carries a sign-off
 * stamp — same rule as web. Returns the stamp or null.
 */
export function columnSignedOffAt(feed: AssessmentFeedResponse): string | Date | null {
  if (feed.data.length === 0) return null;
  let stamp: string | Date | null = null;
  for (const row of feed.data) {
    const at = row.assessment?.subjectSignedOffAt ?? null;
    if (!at) return null;
    stamp = at;
  }
  return stamp;
}

/**
 * Why sign-off is not available yet, or null when it is.
 *
 * Unaccepted comment drafts block it too (CP6b): sign-off freezes the comment
 * as well as the marks, so signing off with a draft on screen would quietly
 * throw that draft away.
 */
export function signOffBlockReason(input: {
  hasUnsavedMarks: boolean;
  hasUnsavedComments?: boolean;
  fullyScored: boolean;
}): string | null {
  if (input.hasUnsavedMarks) return "Save your marks first.";
  if (input.hasUnsavedComments) return "Accept or clear your comment drafts first.";
  if (!input.fullyScored) return "Every student needs every mark before you can sign off.";
  return null;
}
