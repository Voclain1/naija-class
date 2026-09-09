import type { DashboardCollectionGroupDto } from "@school-kit/types";

// Billed-vs-collected, broken down by class level.
//
// Lifted out of dashboard.service.ts when the finance dashboard became a
// second caller. Deliberately NOT copied: the "unassigned" bucket below is a
// bug fix (see below), and a second copy is a second place for that fix to be
// missing. Both dashboards must mean the same thing by these rows.
//
// Lives in the FINANCE module, not the dashboard one, because DashboardService
// already imports FinanceService — putting it here keeps the dependency
// pointing one way instead of introducing a cycle.
//
// Pure function over two row arrays: it does no querying of its own, so each
// caller keeps control of its own tenant-scoped reads.

/**
 * Sorts the synthetic "Unassigned" bucket after every real ClassLevel.
 * MAX_SAFE_INTEGER rather than Infinity so the value survives JSON round trips
 * unchanged if it ever leaks into a payload.
 */
export const UNASSIGNED_ORDER_INDEX = Number.MAX_SAFE_INTEGER;

export const UNASSIGNED_GROUP_ID = "unassigned";

export function buildCollectionByGroup(
  enrollments: Array<{
    studentId: string;
    classArm: { classLevel: { id: string; name: string; orderIndex: number } };
  }>,
  invoices: Array<{ studentId: string; totalDue: number; totalPaid: number }>,
): DashboardCollectionGroupDto[] {
  const studentToLevel = new Map<string, { id: string; name: string; orderIndex: number }>();
  for (const e of enrollments) {
    studentToLevel.set(e.studentId, e.classArm.classLevel);
  }

  const groups = new Map<string, { label: string; orderIndex: number; billed: number; collected: number }>();
  for (const inv of invoices) {
    // An invoice whose student has no ENROLLED row for this term still
    // belongs to the term's totals, so it CANNOT be dropped — doing so made
    // these rows disagree with the fees KPI card directly above them, with
    // nothing on screen explaining the difference. Fixed in #278; carried
    // here deliberately so the finance dashboard does not reintroduce it.
    const level =
      studentToLevel.get(inv.studentId) ??
      ({ id: UNASSIGNED_GROUP_ID, name: "Unassigned", orderIndex: UNASSIGNED_ORDER_INDEX } as const);
    const existing = groups.get(level.id) ?? {
      label: level.name,
      orderIndex: level.orderIndex,
      billed: 0,
      collected: 0,
    };
    existing.billed += inv.totalDue;
    existing.collected += inv.totalPaid;
    groups.set(level.id, existing);
  }

  return Array.from(groups.entries())
    .sort((a, b) => a[1].orderIndex - b[1].orderIndex)
    .map(([groupId, g]) => ({
      groupId,
      label: g.label,
      billed: g.billed,
      collected: g.collected,
      percent: g.billed > 0 ? Math.round((g.collected / g.billed) * 100) : 0,
    }));
}
