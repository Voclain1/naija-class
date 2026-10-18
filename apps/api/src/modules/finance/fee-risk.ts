import type { PrismaClient } from "@school-kit/db";
import { sickbayDayOf, type FeeRiskDto, type FeeRiskReason } from "@school-kit/types";

// Phase 9 / CP10.2 — fee-default risk (docs/modules/phase-9.md §19.3).
//
// Rules over a child's own invoices: no model, no outside data, no stored
// score. Two layers:
//   * assessFeeRisk — the rules, pure, over a summary of one child's history;
//   * computeFeeRisks — reads the invoices and payments under the caller's
//     withTenant and builds those summaries, siblings included.
//
// History is the three terms before the term being looked at. "Overdue now"
// is that term itself. A balance on ANY earlier term counts as owing.

type Db = PrismaClient;

/** How one term invoice was paid against its due date. */
export type TermOutcome = "ON_TIME" | "PAID_LATE" | "SHORT_AT_DUE";

export interface FeeHistory {
  /** Outcomes of the term invoices (with a due date) in the last three terms before this one. */
  recent: TermOutcome[];
  /** Open balances on earlier terms, newest first, kobo. */
  earlierOwing: { termLabel: string; balance: number }[];
  /** Kobo past its due date this term; 0 when nothing is overdue. */
  overdueNow: number;
  /** Terms, this one included, in which the child had a term invoice. */
  termsWithInvoices: number;
}

/** The rules. Order of reasons: the most serious first. */
export function assessFeeRisk(h: FeeHistory): FeeRiskDto {
  const late = h.recent.filter((o) => o === "PAID_LATE").length;
  const short = h.recent.filter((o) => o === "SHORT_AT_DUE").length;
  const of = h.recent.length;

  const reasons: FeeRiskReason[] = [];
  for (const o of h.earlierOwing) reasons.push({ kind: "OWING_EARLIER", termLabel: o.termLabel, balance: o.balance });
  if (h.overdueNow > 0) reasons.push({ kind: "OVERDUE_NOW", balance: h.overdueNow });
  if (late > 0) reasons.push({ kind: "PAID_LATE", count: late, of });
  if (short > 0) reasons.push({ kind: "SHORT_AT_DUE", count: short, of });

  // A child new to the school has too little to judge, unless an earlier
  // balance says otherwise.
  if (h.termsWithInvoices < 2 && h.earlierOwing.length === 0) {
    return { level: "TOO_NEW", reasons: [{ kind: "TOO_NEW" }, ...reasons] };
  }

  const lateTerms = late + short;
  if (h.earlierOwing.length > 0 || (lateTerms >= 2 && h.overdueNow > 0)) return { level: "HIGH", reasons };
  if (lateTerms >= 1 || h.overdueNow > 0) return { level: "WATCH", reasons };
  return { level: "LOW", reasons: of > 0 ? [{ kind: "ON_TIME", of }] : [] };
}

/**
 * How a term invoice was paid against its due date. `paidByDue` counts only
 * successful payments made on or before the due date (a Lagos calendar day).
 */
export function termOutcome(inv: { totalDue: number; totalPaid: number; paidByDue: number }): TermOutcome {
  if (inv.paidByDue >= inv.totalDue) return "ON_TIME";
  return inv.totalPaid >= inv.totalDue ? "PAID_LATE" : "SHORT_AT_DUE";
}

const COUNTED_STATUSES = ["ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE"] as const;
const HISTORY_TERMS = 3;

function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * The risk of each child in `studentIds`, judged at `termId`. Runs inside the
 * caller's withTenant. Siblings (same primary guardian) are read too, so a
 * child whose brother or sister is Watch or High says so.
 */
export async function computeFeeRisks(
  db: Db,
  schoolId: string,
  termId: string,
  studentIds: string[],
  today = sickbayDayOf(new Date()),
): Promise<Map<string, FeeRiskDto>> {
  const result = new Map<string, FeeRiskDto>();
  if (studentIds.length === 0) return result;

  const term = await db.term.findFirst({ where: { id: termId, schoolId }, select: { startDate: true } });
  if (!term) return result;
  const earlier = await db.term.findMany({
    where: { schoolId, startDate: { lt: term.startDate } },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, academicYear: { select: { label: true } } },
  });
  const earlierIds = earlier.map((t) => t.id);
  const historyIds = new Set(earlierIds.slice(0, HISTORY_TERMS));
  const labelOf = new Map(earlier.map((t) => [t.id, `${t.name} ${t.academicYear.label}`]));
  const order = new Map(earlierIds.map((id, i) => [id, i]));

  // Siblings: other children of the same primary guardian.
  const primaries = await db.studentGuardian.findMany({
    where: { schoolId, studentId: { in: studentIds }, isPrimary: true },
    select: { studentId: true, guardianId: true },
  });
  const guardianIds = [...new Set(primaries.map((p) => p.guardianId))];
  const family = guardianIds.length
    ? await db.studentGuardian.findMany({
        where: { schoolId, guardianId: { in: guardianIds }, isPrimary: true },
        select: { studentId: true, guardianId: true },
      })
    : [];
  const childrenOf = new Map<string, string[]>();
  for (const f of family) childrenOf.set(f.guardianId, [...(childrenOf.get(f.guardianId) ?? []), f.studentId]);
  const siblingsOf = new Map<string, string[]>();
  for (const p of primaries) {
    const others = (childrenOf.get(p.guardianId) ?? []).filter((id) => id !== p.studentId);
    siblingsOf.set(p.studentId, [...new Set([...(siblingsOf.get(p.studentId) ?? []), ...others])]);
  }
  const allIds = [...new Set([...studentIds, ...[...siblingsOf.values()].flat()])];

  const invoices = await db.invoice.findMany({
    where: { schoolId, studentId: { in: allIds }, termId: { in: [termId, ...earlierIds] }, status: { in: [...COUNTED_STATUSES] } },
    select: { id: true, studentId: true, termId: true, sequence: true, totalDue: true, totalPaid: true, dueDate: true },
  });

  // Payments are needed only to judge history term invoices against their due date.
  const judged = invoices.filter((i) => i.sequence === 0 && historyIds.has(i.termId) && i.dueDate);
  const payments = judged.length
    ? await db.payment.findMany({
        where: { schoolId, invoiceId: { in: judged.map((i) => i.id) }, status: "SUCCESS" },
        select: { invoiceId: true, amount: true, paidAt: true, createdAt: true },
      })
    : [];
  const paidByDue = new Map<string, number>();
  const dueOf = new Map(judged.map((i) => [i.id, isoDate(i.dueDate)!]));
  for (const p of payments) {
    if (sickbayDayOf(p.paidAt ?? p.createdAt) <= dueOf.get(p.invoiceId)!) {
      paidByDue.set(p.invoiceId, (paidByDue.get(p.invoiceId) ?? 0) + p.amount);
    }
  }

  const byStudent = new Map<string, typeof invoices>();
  for (const i of invoices) byStudent.set(i.studentId, [...(byStudent.get(i.studentId) ?? []), i]);

  const own = new Map<string, FeeRiskDto>();
  for (const id of allIds) {
    const mine = byStudent.get(id) ?? [];
    const recent = mine
      .filter((i) => i.sequence === 0 && historyIds.has(i.termId) && i.dueDate)
      .map((i) => termOutcome({ totalDue: i.totalDue, totalPaid: i.totalPaid, paidByDue: paidByDue.get(i.id) ?? 0 }));
    const owing = new Map<string, number>();
    for (const i of mine) {
      if (i.termId !== termId && i.totalPaid < i.totalDue) owing.set(i.termId, (owing.get(i.termId) ?? 0) + i.totalDue - i.totalPaid);
    }
    const earlierOwing = [...owing.entries()]
      .sort((a, b) => order.get(a[0])! - order.get(b[0])!)
      .map(([t, balance]) => ({ termLabel: labelOf.get(t)!, balance }));
    const overdueNow = mine
      .filter((i) => i.termId === termId && i.dueDate && isoDate(i.dueDate)! < today && i.totalPaid < i.totalDue)
      .reduce((sum, i) => sum + i.totalDue - i.totalPaid, 0);
    const termsWithInvoices = new Set(mine.filter((i) => i.sequence === 0).map((i) => i.termId)).size;
    own.set(id, assessFeeRisk({ recent, earlierOwing, overdueNow, termsWithInvoices }));
  }

  const flagged = [...new Set([...siblingsOf.values()].flat())].filter((id) => {
    const l = own.get(id)?.level;
    return l === "HIGH" || l === "WATCH";
  });
  const names = flagged.length
    ? new Map(
        (await db.student.findMany({ where: { schoolId, id: { in: flagged } }, select: { id: true, firstName: true, lastName: true } })).map(
          (s) => [s.id, `${s.firstName} ${s.lastName}`],
        ),
      )
    : new Map<string, string>();

  for (const id of studentIds) {
    const risk = own.get(id)!;
    const siblingReasons: FeeRiskReason[] = (siblingsOf.get(id) ?? [])
      .filter((s) => names.has(s))
      .map((s) => ({ kind: "SIBLING", studentId: s, name: names.get(s)!, level: own.get(s)!.level as "HIGH" | "WATCH" }));
    result.set(id, { level: risk.level, reasons: [...risk.reasons, ...siblingReasons] });
  }
  return result;
}
