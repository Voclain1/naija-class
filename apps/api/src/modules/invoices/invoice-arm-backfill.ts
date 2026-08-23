import type { Prisma } from "@school-kit/db";

export interface InvoiceArmCandidate {
  invoiceId: string;
  classArmId: string;
}

export interface InvoiceArmUnresolved {
  invoiceId: string;
  reason: "NO_ENROLLMENT" | "ENROLLMENT_CREATED_AFTER_INVOICE" | "ARM_CHANGED_AFTER_INVOICE";
}

export interface InvoiceArmBackfillPlan {
  legacyInvoiceCount: number;
  candidates: InvoiceArmCandidate[];
  unresolved: InvoiceArmUnresolved[];
  candidateCountByArm: Record<string, number>;
}

function changedArm(metadata: Prisma.JsonValue): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const changed = (metadata as Record<string, unknown>).changed;
  return Array.isArray(changed) && changed.includes("classArm");
}

export async function planInvoiceArmBackfill(
  db: Prisma.TransactionClient,
  schoolId: string,
): Promise<InvoiceArmBackfillPlan> {
  const invoices = await db.invoice.findMany({
    where: { schoolId, classArmId: null },
    select: { id: true, studentId: true, termId: true, issuedAt: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const enrollments = invoices.length === 0 ? [] : await db.enrollment.findMany({
    where: {
      schoolId,
      OR: invoices.map(({ studentId, termId }) => ({ studentId, termId })),
    },
    select: { id: true, studentId: true, termId: true, classArmId: true, enrolledAt: true },
  });
  const enrollmentByPair = new Map(
    enrollments.map((row) => [`${row.studentId}:${row.termId}`, row]),
  );
  const armChangeAudits = enrollments.length === 0 ? [] : await db.auditLog.findMany({
    where: {
      schoolId,
      action: "enrollment.update",
      entityType: "enrollment",
      entityId: { in: enrollments.map(({ id }) => id) },
    },
    select: { entityId: true, createdAt: true, metadata: true },
  });

  const candidates: InvoiceArmCandidate[] = [];
  const unresolved: InvoiceArmUnresolved[] = [];
  const candidateCountByArm: Record<string, number> = {};
  for (const invoice of invoices) {
    const enrollment = enrollmentByPair.get(`${invoice.studentId}:${invoice.termId}`);
    if (!enrollment) {
      unresolved.push({ invoiceId: invoice.id, reason: "NO_ENROLLMENT" });
      continue;
    }
    const issueTime = invoice.issuedAt ?? invoice.createdAt;
    if (enrollment.enrolledAt > issueTime) {
      unresolved.push({ invoiceId: invoice.id, reason: "ENROLLMENT_CREATED_AFTER_INVOICE" });
      continue;
    }
    const changedAfterIssue = armChangeAudits.some((audit) =>
      audit.entityId === enrollment.id && audit.createdAt > issueTime && changedArm(audit.metadata),
    );
    if (changedAfterIssue) {
      unresolved.push({ invoiceId: invoice.id, reason: "ARM_CHANGED_AFTER_INVOICE" });
      continue;
    }
    candidates.push({ invoiceId: invoice.id, classArmId: enrollment.classArmId });
    candidateCountByArm[enrollment.classArmId] =
      (candidateCountByArm[enrollment.classArmId] ?? 0) + 1;
  }
  return { legacyInvoiceCount: invoices.length, candidates, unresolved, candidateCountByArm };
}

export async function applyInvoiceArmBackfill(
  db: Prisma.TransactionClient,
  schoolId: string,
  actorUserId: string,
  plan: InvoiceArmBackfillPlan,
): Promise<number> {
  let updated = 0;
  for (const candidate of plan.candidates) {
    const result = await db.invoice.updateMany({
      where: { id: candidate.invoiceId, schoolId, classArmId: null },
      data: { classArmId: candidate.classArmId },
    });
    updated += result.count;
  }
  if (updated !== plan.candidates.length) {
    throw new Error(
      `Backfill reconciliation failed: planned ${plan.candidates.length}, updated ${updated}.`,
    );
  }
  if (updated > 0) {
    await db.auditLog.create({
      data: {
        schoolId,
        userId: actorUserId,
        action: "invoice-arm.backfilled",
        entityType: "school",
        entityId: schoolId,
        metadata: {
          legacyInvoiceCount: plan.legacyInvoiceCount,
          updatedCount: updated,
          unresolvedCount: plan.unresolved.length,
          candidateCountByArm: plan.candidateCountByArm,
        },
      },
    });
  }
  return updated;
}
