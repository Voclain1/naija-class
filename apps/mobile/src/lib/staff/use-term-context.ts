import { useQuery } from "@tanstack/react-query";

import { staffAcademicYears, staffTermsOfYear } from "../api/staff-finance";
import { queryKeys } from "../query/keys";
import { resolveCurrentTerm, type TermResolution } from "./term-context";

// The two-request chain, behind one hook.
//
// Sequential by necessity — the terms endpoint is keyed by the year id the
// first request returns, so these cannot be parallelised. That is the cost
// D16 chose to pay rather than change the server; see term-context.ts.
//
// Cached under a "staff" key so it is never persisted, and given a longer
// staleTime than the money figures: which term is current changes a handful of
// times a year, whereas collections change whenever a parent pays. Re-running
// the chain on every screen focus would triple the request count for an answer
// that almost never moves.
const TERM_CONTEXT_STALE_MS = 10 * 60 * 1000;

export function useTermContext(args: {
  schoolId: string;
  userId: string;
  enabled: boolean;
}) {
  return useQuery<TermResolution>({
    queryKey: queryKeys.staffTermContext(args.schoolId, args.userId),
    enabled: args.enabled && args.schoolId !== "" && args.userId !== "",
    staleTime: TERM_CONTEXT_STALE_MS,
    queryFn: async () => {
      const years = await staffAcademicYears();
      const current = years.find((y) => y.isCurrent);
      // Don't spend the second round-trip when the first already decided the
      // outcome — resolveCurrentTerm names that failure from `years` alone.
      if (!current) return resolveCurrentTerm(years, null);
      const terms = await staffTermsOfYear(current.id);
      return resolveCurrentTerm(years, terms);
    },
  });
}
