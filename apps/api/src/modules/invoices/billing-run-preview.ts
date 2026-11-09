import { createHash } from "node:crypto";
import type { BillingRunArmDto, BillingRunInput } from "@school-kit/types";
import type { InvoiceRunPreviewLine } from "./invoice-generation.service.js";

export function buildBillingPreview(
  input: BillingRunInput,
  selected: { id: string; label: string; rows: InvoiceRunPreviewLine[] }[],
  termLabel = "",
) {
  const sorted = [...selected].sort((a, b) => a.id.localeCompare(b.id));
  const arms: BillingRunArmDto[] = sorted.map((arm) => {
    const pending = arm.rows.filter((r) => !r.alreadyInvoiced);
    return {
      classArmId: arm.id, label: arm.label,
      rows: arm.rows.map(({ snapshotHash: _snapshotHash, ...row }) => row),
      createCount: pending.length, skipCount: arm.rows.length - pending.length,
      totalDueKobo: pending.reduce((n, r) => n + BigInt(r.totalDue), 0n).toString(),
      missingFees: pending.some((r) => r.feeItemCount === 0),
    };
  });
  const blockers: string[] = [];
  if (arms.some((a) => a.missingFees)) blockers.push("Some selected classes have no applicable fee items. Set up their fees, then prepare a new preview.");
  if (arms.reduce((n, a) => n + a.rows.length, 0) > 200) blockers.push("Select fewer classes: a run can cover up to 200 enrolled students.");
  const createCount = arms.reduce((n, a) => n + a.createCount, 0);
  if (!createCount) blockers.push("There are no new term invoices to issue for these classes.");
  // Full snapshots, not just totals: a same-price line rename also needs review.
  const previewHash = createHash("sha256").update(JSON.stringify({
    termId: input.termId, termLabel, dueDate: input.dueDate ?? null,
    arms: sorted.map((a) => ({ id: a.id, label: a.label,
      rows: [...a.rows].sort((x, y) => x.studentId.localeCompare(y.studentId)) })),
  })).digest("hex");
  return {
    arms, blockers, createCount,
    skipCount: arms.reduce((n, a) => n + a.skipCount, 0),
    totalDueKobo: arms.reduce((n, a) => n + BigInt(a.totalDueKobo), 0n).toString(),
    previewHash,
  };
}
