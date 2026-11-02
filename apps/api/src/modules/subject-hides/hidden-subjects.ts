import type { withTenant } from "@school-kit/db";
import { hideApplies } from "@school-kit/types";

// The subjects hidden from one arm's results in one term (2026-11-02,
// docs/modules/subjects-by-class.md). Every results reader calls this (report
// card build and detail, released results for families and the result
// checker, the positions pass) so a hidden subject is left out the same way
// everywhere. Runs under the caller's tenant transaction.

type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

export async function hiddenSubjectIds(db: TenantDb, termId: string, classArmId: string): Promise<Set<string>> {
  const hides = await db.subjectHide.findMany({
    where: { unhiddenAt: null },
    select: {
      subjectId: true,
      scope: true,
      classArmId: true,
      classLevelId: true,
      until: true,
      termId: true,
      academicYearId: true,
      unhiddenAt: true,
      term: { select: { startDate: true } },
    },
  });
  if (hides.length === 0) return new Set();
  const [term, arm] = await Promise.all([
    db.term.findUnique({ where: { id: termId }, select: { academicYearId: true, startDate: true } }),
    db.classArm.findUnique({ where: { id: classArmId }, select: { classLevelId: true } }),
  ]);
  if (!term || !arm) return new Set();
  const at = {
    termId,
    academicYearId: term.academicYearId,
    termStartDate: term.startDate,
    classArmId,
    classLevelId: arm.classLevelId,
  };
  const out = new Set<string>();
  for (const h of hides) {
    if (
      hideApplies(
        {
          scope: h.scope as "ARM" | "LEVEL" | "SCHOOL",
          classArmId: h.classArmId,
          classLevelId: h.classLevelId,
          until: h.until as "TERM" | "YEAR" | "INDEFINITE",
          termId: h.termId,
          academicYearId: h.academicYearId,
          termStartDate: h.term.startDate,
          unhiddenAt: h.unhiddenAt,
        },
        at,
      )
    ) {
      out.add(h.subjectId);
    }
  }
  return out;
}
