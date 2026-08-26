import type { AcademicYearDto, TermDto } from "@school-kit/types";

// Warn when a fee item is being scoped outside the CURRENT academic year.
//
// Added 2026-08-26 after a real incident at a pilot school. A fee item was
// scoped to "Second Term" of academic year 2026/2027 while the school's
// current term was "Second Term" of 2025/2026 — same term NAME, different
// year, different id. Invoice generation requires all four scope fields to
// match (fetchFeeItems treats null as "applies to all"), so it matched
// nothing and returned zero invoices, which read as broken arm scoping.
//
// Nothing about that configuration is invalid — a school may legitimately set
// next year's fees in advance. The failure was that it was SILENT: the item
// looked correct, and generation just produced nothing with no explanation.
export type FeeScopeWarning =
  | { kind: "FUTURE_OR_PAST_YEAR"; yearLabel: string }
  | { kind: "TERM_IN_OTHER_YEAR"; termName: string; yearLabel: string };

export function feeScopeWarning(args: {
  academicYearId: string | null;
  termId: string | null;
  years: readonly AcademicYearDto[];
  terms: readonly TermDto[];
}): FeeScopeWarning | null {
  const currentYear = args.years.find((y) => y.isCurrent);
  // With no current year marked there is nothing to compare against, and the
  // school has a bigger problem than this warning.
  if (!currentYear) return null;

  // A term pinned to a different year is the sharper case, so it is checked
  // first: it is the one that produces two terms with the same NAME.
  if (args.termId) {
    const term = args.terms.find((t) => t.id === args.termId);
    if (term && term.academicYearId !== currentYear.id) {
      const owner = args.years.find((y) => y.id === term.academicYearId);
      return {
        kind: "TERM_IN_OTHER_YEAR",
        termName: term.name,
        yearLabel: owner?.label ?? "another year",
      };
    }
  }

  if (args.academicYearId && args.academicYearId !== currentYear.id) {
    const chosen = args.years.find((y) => y.id === args.academicYearId);
    return { kind: "FUTURE_OR_PAST_YEAR", yearLabel: chosen?.label ?? "another year" };
  }

  return null;
}

export function feeScopeWarningText(w: FeeScopeWarning): string {
  if (w.kind === "TERM_IN_OTHER_YEAR") {
    return `This is ${w.termName} of ${w.yearLabel}, not the current year. Invoices generated for the current term will NOT include this fee.`;
  }
  return `${w.yearLabel} is not the current academic year. Invoices generated for the current term will NOT include this fee.`;
}
