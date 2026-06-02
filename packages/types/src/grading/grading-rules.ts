// Pure grading-config invariants, shared by BOTH the Zod refines (bulk-PUT
// request validation, for bindable UX) and the service layer (which
// re-validates the resulting set after a single POST/PATCH/DELETE). Keeping
// them here means the rule lives in exactly one place — the API edge and the
// service can never disagree about what "valid" means.
//
// Each validator returns a human-readable message string when the set is
// INVALID, or null when it's valid. Callers decide how to surface it (a Zod
// issue bound to a path, or a thrown ValidationError).

// The set of grading-component weights for a school MUST sum to exactly 100.
// Enforced over the WHOLE set, never per-row (a single PATCH that drops one
// component's weight breaks the sum even though that row is individually fine).
export function findWeightSumError(weights: readonly number[]): string | null {
  if (weights.length === 0) {
    return "A grading scheme needs at least one component.";
  }
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total !== 100) {
    return `Component weights must sum to exactly 100 (currently ${total}).`;
  }
  return null;
}

// Grade boundaries must TILE 0..100: inclusive ranges, sorted ascending, with
// no gaps and no overlaps, the lowest band starting at 0 and the highest ending
// at 100. Returns the first problem found (in ascending-band order) or null.
export function findBoundaryTilingError(
  bands: readonly { minScore: number; maxScore: number }[],
): string | null {
  if (bands.length === 0) {
    return "A grading scale needs at least one boundary band.";
  }

  // Per-band sanity before checking the tiling.
  for (const b of bands) {
    if (b.minScore < 0 || b.maxScore > 100) {
      return "Boundary scores must be within 0–100.";
    }
    if (b.minScore > b.maxScore) {
      return `A boundary's minimum (${b.minScore}) cannot exceed its maximum (${b.maxScore}).`;
    }
  }

  const sorted = [...bands].sort((a, b) => a.minScore - b.minScore);

  if (sorted[0]!.minScore !== 0) {
    return "The lowest grade band must start at 0.";
  }
  if (sorted[sorted.length - 1]!.maxScore !== 100) {
    return "The highest grade band must end at 100.";
  }

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    if (curr.minScore !== prev.maxScore + 1) {
      if (curr.minScore <= prev.maxScore) {
        return `Grade bands overlap around ${curr.minScore}.`;
      }
      return `Grade bands leave a gap between ${prev.maxScore} and ${curr.minScore}.`;
    }
  }

  return null;
}
