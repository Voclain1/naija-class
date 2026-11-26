import { Injectable, Logger } from "@nestjs/common";

import { allocateSchedule, targetedPayments } from "./installment-progress.js";
import { type PrismaClient, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type CreatePaymentPlanInput,
  type PaymentPlanDto,
  type PaymentPlanInstallmentDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";

// ---------------------------------------------------------------------------
// Internal row shapes
// ---------------------------------------------------------------------------

type InstallmentRow = {
  id: string;
  planId: string;
  amount: number;
  dueDate: Date;
  paid: boolean;
};

type PlanRow = {
  id: string;
  schoolId: string;
  invoiceId: string;
  name: string;
  createdBy: string;
  createdAt: Date;
  installments: InstallmentRow[];
};

// ---------------------------------------------------------------------------
// Pure helper — exported for direct unit testing
// ---------------------------------------------------------------------------

// Given a sorted-by-dueDate list of installment amounts and the current totalPaid,
// returns a parallel boolean array: paid[i] = true when the cumulative sum of
// amounts[0..i] is <= totalPaid.
//
// Example — amounts [50_000, 50_000, 50_000], totalPaid = 80_000:
//   cumulative:  [50_000, 100_000, 150_000]
//   result:      [true,   false,   false  ]
export function computeInstallmentsPaid(amounts: number[], totalPaid: number): boolean[] {
  return projectUntargetedPayments(amounts, totalPaid).map(({ outstanding }) => outstanding === 0);
}

/** Existing invoice payments have no instalment target. Apply them in schedule
 * order for display. Targeted payment settlement must use explicit attribution. */
export function projectUntargetedPayments(amounts: number[], totalPaid: number) {
  let remaining = Math.max(0, totalPaid);
  return amounts.map((amount) => {
    const amountPaid = Math.min(amount, remaining);
    remaining -= amountPaid;
    return { amountPaid, outstanding: amount - amountPaid };
  });
}

// ---------------------------------------------------------------------------
// DTO helpers
// ---------------------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function toInstallmentDto(row: InstallmentRow, progress: { amountPaid: number; outstanding: number }): PaymentPlanInstallmentDto {
  const paid = progress.outstanding === 0;
  const dueDateStr =
    row.dueDate instanceof Date ? row.dueDate.toISOString().slice(0, 10) : String(row.dueDate).slice(0, 10);
  return {
    id: row.id,
    planId: row.planId,
    amount: row.amount,
    dueDate: dueDateStr,
    ...progress,
    paid,
    isOverdue: !paid && dueDateStr < todayIso(),
  };
}

function toDto(
  row: PlanRow,
  totalPaid: number,
  targeted: Parameters<typeof allocateSchedule>[2] = [],
): PaymentPlanDto {
  const progress = allocateSchedule(row.installments, totalPaid, targeted);
  return {
    id: row.id,
    schoolId: row.schoolId,
    invoiceId: row.invoiceId,
    name: row.name,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    installments: row.installments.map((installment, index) => toInstallmentDto(installment, { amountPaid: progress[index]!.amountPaid, outstanding: progress[index]!.outstanding })),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class PaymentPlanService {
  private readonly logger = new Logger(PaymentPlanService.name);

  // ─── Create plan ──────────────────────────────────────────────────────────

  async create(authCtx: AuthContext, dto: CreatePaymentPlanInput): Promise<PaymentPlanDto> {
    return withTenant(authCtx.schoolId, (db) => this.createInTransaction(db, authCtx, dto));
  }

  async createInTransaction(
    db: PrismaClient,
    authCtx: Pick<AuthContext, "schoolId" | "userId">,
    dto: CreatePaymentPlanInput,
  ): Promise<PaymentPlanDto> {
    await db.$queryRaw`SELECT id FROM invoices WHERE school_id = ${authCtx.schoolId} AND id = ${dto.invoiceId} FOR UPDATE`;
    // 1. Load invoice.
    const invoice = await db.invoice.findUnique({
      where: { id: dto.invoiceId },
      select: { id: true, schoolId: true, status: true, totalDue: true, totalPaid: true },
    });
    if (!invoice || invoice.schoolId !== authCtx.schoolId) {
      throw new NotFoundError("Invoice not found.");
    }

    // 2. Status gate — ISSUED and PARTIALLY_PAID allowed (D4, amended).
    if (invoice.status !== "ISSUED" && invoice.status !== "PARTIALLY_PAID") {
      throw new ConflictError(
        "INVOICE_NOT_PLANNABLE",
        `Cannot create an installment plan for an invoice in status ${invoice.status}.`,
      );
    }

    // 3. One plan per invoice (D3).
    const existing = await db.paymentPlan.findUnique({
      where: { schoolId_invoiceId: { schoolId: authCtx.schoolId, invoiceId: dto.invoiceId } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError(
        "PLAN_ALREADY_EXISTS",
        "This invoice already has an installment plan. Delete it before creating a new one.",
      );
    }

    // 4. Sum constraint — Σ installment.amount must equal invoice.totalDue (D2).
    const installmentTotal = dto.installments.reduce((sum, i) => sum + i.amount, 0);
    if (installmentTotal !== invoice.totalDue) {
      throw new ConflictError(
        "INSTALLMENT_SUM_MISMATCH",
        `Installment amounts sum to ${installmentTotal} kobo but invoice totalDue is ${invoice.totalDue} kobo. They must be equal.`,
      );
    }

    // 5. Create plan + installments atomically.
    await db.paymentPlan.create({
      data: {
        schoolId: authCtx.schoolId,
        invoiceId: dto.invoiceId,
        name: dto.name,
        createdBy: authCtx.userId,
        installments: {
          create: dto.installments.map((i) => ({
            schoolId: authCtx.schoolId,
            amount: i.amount,
            dueDate: new Date(i.dueDate),
          })),
        },
      },
    });

    // 6. Immediately recompute paid status — handles PARTIALLY_PAID invoices (D4 amendment).
    await this.recomputeInstallmentsPaid(db, dto.invoiceId, invoice.totalPaid);

    const plan = await db.paymentPlan.findUniqueOrThrow({
      where: { schoolId_invoiceId: { schoolId: authCtx.schoolId, invoiceId: dto.invoiceId } },
      include: { installments: { orderBy: [{ dueDate: "asc" }, { id: "asc" }] } },
    });

    return toDto(plan as PlanRow, invoice.totalPaid);
  }

  // ─── Find by invoice ──────────────────────────────────────────────────────

  async findByInvoice(authCtx: AuthContext, invoiceId: string): Promise<PaymentPlanDto | null> {
    return withTenant(authCtx.schoolId, async (db) => {
      const plan = await db.paymentPlan.findUnique({
        where: { schoolId_invoiceId: { schoolId: authCtx.schoolId, invoiceId } },
        include: {
          invoice: { select: { totalPaid: true, payments: targetedPayments } },
          installments: { orderBy: [{ dueDate: "asc" }, { id: "asc" }] },
        },
      });
      if (!plan) return null;
      return toDto(plan, plan.invoice.totalPaid, plan.invoice.payments);
    });
  }

  // ─── Delete plan ──────────────────────────────────────────────────────────

  async delete(authCtx: AuthContext, planId: string): Promise<void> {
    return withTenant(authCtx.schoolId, async (db) => {
      const plan = await db.paymentPlan.findUnique({
        where: { id: planId },
        select: { id: true, schoolId: true, invoiceId: true },
      });
      if (!plan || plan.schoolId !== authCtx.schoolId) {
        throw new NotFoundError("Payment plan not found.");
      }

      await db.$queryRaw`SELECT id FROM invoices WHERE school_id = ${authCtx.schoolId} AND id = ${plan.invoiceId} FOR UPDATE`;
      const hasTarget = await db.paymentPlanInstallment.findFirst({
        where: { planId, OR: [{ payments: { some: {} } }, { paymentLinks: { some: {} } }] },
        select: { id: true },
      });
      // Lock check — cannot delete once any payment is recorded (D6).
      const invoice = await db.invoice.findUniqueOrThrow({
        where: { id: plan.invoiceId },
        select: { totalPaid: true },
      });
      if (hasTarget || invoice.totalPaid > 0) {
        throw new ConflictError(
          "PLAN_LOCKED_PAYMENTS_EXIST",
          "Cannot delete an installment plan after payments have been recorded against the invoice.",
        );
      }

      // Cascade deletes installments via FK (onDelete: Cascade).
      await db.paymentPlan.delete({ where: { id: planId } });
    });
  }

  // ─── Recompute installment paid status ────────────────────────────────────
  //
  // Called by PaymentsService after every successful payment — both recordManual
  // and applyPaystackSuccess. Accepts the already-computed totalPaid to avoid an
  // extra DB round-trip. If the invoice has no plan, returns immediately (no-op).
  //
  // The `db` parameter is the tenant-scoped PrismaClient already open in the
  // caller's withTenant() callback — no new connection is opened.

  async recomputeInstallmentsPaid(
    db: PrismaClient,
    invoiceId: string,
    totalPaid: number,
  ): Promise<void> {
    const plan = await db.paymentPlan.findFirst({
      where: { invoiceId },
      include: { installments: { orderBy: [{ dueDate: "asc" }, { id: "asc" }] } },
    });
    if (!plan) return;

    const targeted = await db.payment.findMany({
      ...targetedPayments,
      where: { ...targetedPayments.where, invoiceId, schoolId: plan.schoolId },
    });
    const paidFlags = allocateSchedule(plan.installments, totalPaid, targeted).map(({ outstanding }) => outstanding === 0);

    const toUpdate = plan.installments.filter((inst, idx) => inst.paid !== paidFlags[idx]);
    if (toUpdate.length === 0) return;

    await Promise.all(
      toUpdate.map((inst, _i) => {
        const newPaid = paidFlags[plan.installments.indexOf(inst)];
        return db.paymentPlanInstallment.update({
          where: { id: inst.id },
          data: { paid: newPaid },
        });
      }),
    );

    this.logger.log(
      `recomputeInstallmentsPaid: invoiceId=${invoiceId} updated ${toUpdate.length} installment(s)`,
    );
  }
}
