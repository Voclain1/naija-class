import { z } from "zod";

import type { AssessmentFeedRowDto, GradingComponentDto } from "@school-kit/types";

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

export function makeGradebookSchema(components: { id: string; weight: number }[]) {
  const weightById = new Map(components.map((c) => [c.id, c.weight]));
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
): GradebookFormValues {
  return {
    rows: rows.map((row) => {
      const scoreByComponent = new Map(row.scores.map((s) => [s.componentId, s.score]));
      const scores: Record<string, string> = {};
      for (const component of components) {
        const value = scoreByComponent.get(component.id);
        scores[component.id] = value === undefined ? "" : String(value);
      }
      return { studentId: row.student.id, scores };
    }),
  };
}
