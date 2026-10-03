import { z } from "zod";

import type {
  AssessmentFeedResponse,
  AssessmentFeedRowDto,
  GradingComponentDto,
} from "@school-kit/types";
import { MAX_RAW_OUT_OF } from "@school-kit/types";

// FORM-CLASS DISCIPLINE at grid scale (fix/empty-optional-forms + slice-1 cp2):
//   - FormValues hold STRINGS per cell (empty = unentered), coerced to int only
//     at save (cp2). The bulk API body schema is SEPARATE.
//   - The Zod schema is built by a FACTORY parametrized by the loaded scheme, so
//     each cell validates against ITS component's weight, with issues bound to a
//     real path ["rows", i, "scores", componentId] that react-hook-form can
//     surface per-cell. Zero `as never`.

export interface GradebookFormValues {
  rows: { studentId: string; scores: Record<string, string> }[];
}

// Per-cell rule, reused by the Zod refine (and by cp2's pre-submit guard).
// Empty is allowed (unentered cell); otherwise an integer in 0..weight. Returns
// a short message (fits a narrow cell) or null when valid.
export function cellError(value: string, weight: number): string | null {
  const v = value.trim();
  if (v === "") return null;
  if (!/^\d+$/.test(v)) return "0–" + weight;
  if (Number(v) > weight) return "0–" + weight;
  return null;
}

/**
 * Phase 8c / CP5a (phase-8.md §22.1, D60) — a column entered "out of" some
 * total instead of in the component's weight. componentId → that total, or
 * absent for a column entered in weight units, as always.
 */
export type ColumnOutOf = Record<string, number | undefined>;

/**
 * The "out of" a column was last saved with, so reopening it shows the marks
 * as they were typed: the total EVERY saved raw mark in the column shares, or
 * undefined if any score was typed in weight units or the totals differ.
 */
export function inferColumnOutOf(rows: AssessmentFeedRowDto[], componentId: string): number | undefined {
  let outOf: number | undefined;
  for (const row of rows) {
    const score = row.scores.find((s) => s.componentId === componentId);
    if (!score) continue;
    if (score.rawOutOf === null || score.rawOutOf === undefined) return undefined;
    if (outOf !== undefined && outOf !== score.rawOutOf) return undefined;
    outOf = score.rawOutOf;
  }
  return outOf;
}

export function makeGradebookSchema(components: { id: string; weight: number }[], outOf: ColumnOutOf = {}) {
  // A column entered out of N accepts marks up to N; the server scales them.
  const weightById = new Map(components.map((c) => [c.id, outOf[c.id] ?? c.weight]));
  return z
    .object({
      rows: z.array(
        z.object({
          studentId: z.string(),
          scores: z.record(z.string()),
        }),
      ),
    })
    .superRefine((value, ctx) => {
      value.rows.forEach((row, i) => {
        for (const [componentId, raw] of Object.entries(row.scores)) {
          const weight = weightById.get(componentId);
          if (weight === undefined) continue;
          const error = cellError(raw, weight);
          if (error) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: error,
              path: ["rows", i, "scores", componentId],
            });
          }
        }
      });
    });
}

// Seed the form from the feed: one row per student, scores keyed by componentId
// (empty string for a component the student has no score for yet). Row order
// follows the feed (server sorts by lastName, firstName).
export function buildDefaultValues(
  rows: AssessmentFeedRowDto[],
  components: GradingComponentDto[],
  outOf: ColumnOutOf = {},
): GradebookFormValues {
  return {
    rows: rows.map((row) => {
      const scoreByComponent = new Map(row.scores.map((s) => [s.componentId, s]));
      const scores: Record<string, string> = {};
      for (const component of components) {
        const saved = scoreByComponent.get(component.id);
        const total = outOf[component.id];
        if (!saved) {
          scores[component.id] = "";
        } else if (total === undefined) {
          scores[component.id] = String(saved.score);
        } else {
          // In "out of" mode a cell shows the mark as typed — but only when it
          // was typed against THIS total. Anything else would be a figure in
          // the wrong units, so the cell starts empty and shows what is saved.
          scores[component.id] = saved.rawOutOf === total && saved.rawScore !== null ? String(saved.rawScore) : "";
        }
      }
      return { studentId: row.student.id, scores };
    }),
  };
}

export interface DirtyCell {
  studentId: string;
  componentId: string;
}

// Shape of RHF's dirtyFields for our form (loosely typed there).
type DirtyFields = {
  rows?: Array<{ scores?: Record<string, boolean | undefined> } | undefined>;
};

// Extract the CHANGED, non-empty cells into bulk-save rows, in a DETERMINISTIC
// order (by studentId, then componentId) so the server's path ['rows', i,
// 'score'] maps back to a known cell (cellByIndex[i]). Empty cells are skipped:
// a blank cell is "unentered", and the upsert bulk endpoint cannot unset a
// score (Q1 dirty-cells-only payload).
export function collectDirtyRows(
  values: GradebookFormValues,
  dirtyFields: DirtyFields,
): { rows: { studentId: string; componentId: string; score: number }[]; cellByIndex: DirtyCell[] } {
  const collected: { studentId: string; componentId: string; score: number }[] = [];
  (dirtyFields.rows ?? []).forEach((dirtyRow, i) => {
    const row = values.rows[i];
    if (!row || !dirtyRow?.scores) return;
    for (const [componentId, isDirty] of Object.entries(dirtyRow.scores)) {
      if (!isDirty) continue;
      const raw = (row.scores[componentId] ?? "").trim();
      if (raw === "") continue; // can't unset a score via the upsert bulk path
      collected.push({ studentId: row.studentId, componentId, score: Number(raw) });
    }
  });
  collected.sort((a, b) =>
    a.studentId === b.studentId
      ? a.componentId.localeCompare(b.componentId)
      : a.studentId.localeCompare(b.studentId),
  );
  return {
    rows: collected,
    cellByIndex: collected.map((r) => ({ studentId: r.studentId, componentId: r.componentId })),
  };
}

/**
 * The header's "Out of" box: empty (or the weight itself) means the column is
 * entered in weight units as before; otherwise a whole number 1..1000.
 */
export function parseOutOfInput(text: string, weight: number): { outOf: number | undefined } | { error: string } {
  const v = text.trim();
  if (v === "") return { outOf: undefined };
  if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > MAX_RAW_OUT_OF) {
    return { error: `Out of must be a whole number from 1 to ${MAX_RAW_OUT_OF}.` };
  }
  return { outOf: Number(v) === weight ? undefined : Number(v) };
}

export type SaveRow =
  | { studentId: string; componentId: string; score: number }
  | { studentId: string; componentId: string; raw: { mark: number; outOf: number } };

/**
 * The dirty cells as the bulk save takes them: a weight-units score, or — for
 * a column entered out of N — a raw mark the SERVER scales (D60).
 */
export function toSaveRows(
  rows: { studentId: string; componentId: string; score: number }[],
  outOf: ColumnOutOf,
): SaveRow[] {
  return rows.map((r) => {
    const total = outOf[r.componentId];
    return total === undefined
      ? r
      : { studentId: r.studentId, componentId: r.componentId, raw: { mark: r.score, outOf: total } };
  });
}

// Whether every enrolled student has a score for every scheme component — the
// client-side mirror of the bulk sign-off gate. Reads the SAVED feed.
export function isColumnFullyScored(
  feed: AssessmentFeedResponse,
  components: GradingComponentDto[],
): boolean {
  if (feed.data.length === 0) return false;
  return feed.data.every((row) => {
    const scored = new Set(row.scores.map((s) => s.componentId));
    return components.every((c) => scored.has(c.id));
  });
}

// The column is signed off when EVERY student's summary carries a sign-off
// timestamp. Returns that timestamp (for the badge) or null.
export function columnSignedOffAt(feed: AssessmentFeedResponse): string | Date | null {
  if (feed.data.length === 0) return null;
  let stamp: string | Date | null = null;
  for (const row of feed.data) {
    const at = row.assessment?.subjectSignedOffAt ?? null;
    if (!at) return null; // any unsigned row → column not signed off
    stamp = at;
  }
  return stamp;
}
