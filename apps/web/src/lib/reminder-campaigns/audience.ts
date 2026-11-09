import type { DebtorDto, FeeRiskLevel, SendRemindersResult } from "@school-kit/types";

export interface ReminderFilters { search: string; classArm: string; risk: FeeRiskLevel | ""; overdueOnly: boolean; excludePlans: boolean }
export interface ReminderStudent { studentId: string; name: string; admissionNumber: string; classArm: string; invoices: DebtorDto[] }
export const DEFAULT_REMINDER_FILTERS: ReminderFilters = { search: "", classArm: "", risk: "", overdueOnly: true, excludePlans: true };
export const REMINDER_BATCH_SIZE = 50; // Existing endpoint contract; no client-side money arithmetic.
export const MAX_REMINDER_CAMPAIGN_STUDENTS = 500;

/** Select a student once even when term and supplementary invoices both match.
 * All outstanding invoices remain visible; the server computes the actual reminder balance. */
export function reminderAudience(rows: DebtorDto[], filters: ReminderFilters): ReminderStudent[] {
  const grouped = new Map<string, ReminderStudent>();
  for (const d of rows) {
    if (d.balance <= 0) continue;
    const student = grouped.get(d.studentId) ?? { studentId: d.studentId, name: d.studentName, admissionNumber: d.admissionNumber, classArm: d.classArm, invoices: [] };
    student.invoices.push(d); grouped.set(d.studentId, student);
  }
  const search = filters.search.trim().toLocaleLowerCase();
  return [...grouped.values()].filter((s) =>
    (!filters.excludePlans || !s.invoices.some((i) => i.hasPaymentPlan)) &&
    (!filters.classArm || s.invoices.some((i) => i.classArm === filters.classArm)) &&
    (!filters.risk || s.invoices.some((i) => i.risk.level === filters.risk)) &&
    (!filters.overdueOnly || s.invoices.some((i) => i.status === "OVERDUE")) &&
    (!search || `${s.name} ${s.admissionNumber}`.toLocaleLowerCase().includes(search))
  ).sort((a, b) => a.name.localeCompare(b.name) || a.studentId.localeCompare(b.studentId));
}

export function reminderBatches(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids)]; const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += REMINDER_BATCH_SIZE) batches.push(unique.slice(i, i + REMINDER_BATCH_SIZE));
  return batches;
}

export function validReminderResult(result: SendRemindersResult, attempted: number): boolean {
  const counts = [result.sent, result.skipped, ...Object.values(result.skippedBy ?? {})];
  return counts.every((n) => Number.isSafeInteger(n) && n >= 0) &&
    result.sent + result.skipped === attempted &&
    ["NO_BALANCE", "NO_GUARDIAN", "NO_CONTACT", "NOT_DELIVERED"].every((k) => k in (result.skippedBy ?? {})) &&
    Object.keys(result.skippedBy).length === 4 &&
    (result.noChannel
      ? result.sent === 0 && result.skipped === attempted && Object.values(result.skippedBy).every((n) => n === 0)
      : Object.values(result.skippedBy).reduce((sum, n) => sum + n, 0) === result.skipped) &&
    typeof result.noChannel === "boolean";
}
