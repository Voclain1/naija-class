import type { withTenant } from "@school-kit/db";

type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

// Phase 8 / CP6a (§20.3, D52): a term is the FINAL term of its academic year
// when no term in the same year has a higher sequence. Derived, never stored —
// a school that adds a term later moves "final" with it, and there is no flag
// to fall out of step. Only the final term's cards take a promotion status.
export async function isFinalTerm(db: TenantDb, termId: string): Promise<boolean> {
  const term = await db.term.findUnique({
    where: { id: termId },
    select: { academicYearId: true, sequence: true },
  });
  if (!term) return false;
  const later = await db.term.count({
    where: { academicYearId: term.academicYearId, sequence: { gt: term.sequence } },
  });
  return later === 0;
}
