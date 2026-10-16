// Phase 9 / CP4.1 — the paste indicator (docs/modules/phase-9.md §11 CP4-D4,
// Q7). Counts how an answer arrived: typed, or pasted.
//
// A phone's text box reports only the new text, never "this was a paste", so
// the rule is about size: one change that adds PASTE_THRESHOLD characters or
// more counts as pasted, anything smaller as typed. Predictive text and swipe
// typing insert a word at a time, which stays under the threshold. Deleting
// changes neither count.
//
// It is a hint for the teacher, never an accusation, and never part of a mark.
// The student is told it is counted; the teacher is told the device reported it.

export const PASTE_THRESHOLD = 15;

export interface PasteCounts {
  typed: number;
  pasted: number;
}

export function countChange(previous: string, next: string, counts: PasteCounts): PasteCounts {
  const added = next.length - previous.length;
  if (added <= 0) return counts;
  return added >= PASTE_THRESHOLD
    ? { typed: counts.typed, pasted: counts.pasted + added }
    : { typed: counts.typed + added, pasted: counts.pasted };
}
