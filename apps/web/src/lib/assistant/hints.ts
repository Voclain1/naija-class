import type { RouteHints } from "@school-kit/types";

// Turns the router's structural hints into a PREFILL for the card's controls.
// A prefill is only a starting point: the person sees and can change every
// selection, and nothing runs until they ask for the server's preview.

export interface TermLike { id: string; name: string; isCurrent: boolean; sequence?: number; academicYearId?: string }

const ORDINALS: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3 };
function sequenceOf(t: TermLike): number | undefined {
  if (typeof t.sequence === "number") return t.sequence;
  const word = t.name.toLowerCase().split(/\s+/).find((w) => w in ORDINALS);
  return word ? ORDINALS[word] : undefined;
}

/** The term a hint names, within the current academic year when there is one. */
export function resolveTermHint(terms: readonly TermLike[], hint: RouteHints["term"]): string | null {
  const current = terms.find((t) => t.isCurrent) ?? null;
  const sameYear = current?.academicYearId ? terms.filter((t) => t.academicYearId === current.academicYearId) : terms;
  if (hint === undefined || hint === "current") return current?.id ?? null;
  if (hint === "next") {
    if (!current) return null;
    const seq = sequenceOf(current);
    return seq === undefined ? null : (sameYear.find((t) => sequenceOf(t) === seq + 1)?.id ?? null);
  }
  const matches = sameYear.filter((t) => sequenceOf(t) === hint);
  return matches.length === 1 ? matches[0]!.id : null;
}
