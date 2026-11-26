import { Injectable, Optional } from "@nestjs/common";
import { withGuardian, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError, NotFoundError, installmentPolicySchema, installmentProposalSchema,
  type CreateInstallmentInput, type InstallmentPolicy, type InstallmentRequestDecision, type InstallmentRequestDto,
} from "@school-kit/types";
import type { AuthContext } from "../../common/auth/auth-context.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { EventNotifierService } from "../notifications/event-notifier.service.js";
import { PaymentPlanService } from "./payment-plan.service.js";

const defaultPolicy: InstallmentPolicy = {
  enabled: false, maxInstallments: 4, minimumFirstKobo: 0, requireWithinTerm: true,
};

@Injectable()
export class InstallmentRequestsService {
  constructor(private readonly plans: PaymentPlanService, @Optional() private readonly events?: EventNotifierService) {}

  async policy(db: PrismaClient, schoolId: string): Promise<InstallmentPolicy> {
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { installmentPolicy: true } });
    const parsed = installmentPolicySchema.safeParse(school?.installmentPolicy);
    return parsed.success ? parsed.data : defaultPolicy;
  }

  async setPolicy(ctx: AuthContext, policy: InstallmentPolicy) {
    await assertUserActiveAndHasOneOf(ctx, ["owner", "admin"]);
    return withTenant(ctx.schoolId, async (db) => {
      await db.school.update({ where: { id: ctx.schoolId }, data: { installmentPolicy: policy } });
      await db.auditLog.create({ data: {
        schoolId: ctx.schoolId, userId: ctx.userId, action: "installment-policy.updated",
        entityType: "school", entityId: ctx.schoolId, metadata: policy,
      } });
      return policy;
    });
  }

  async staffView(ctx: AuthContext, invoiceId: string) {
    return withTenant(ctx.schoolId, async (db) => ({
      policy: await this.policy(db, ctx.schoolId),
      requests: await this.list(db, ctx.schoolId, invoiceId),
    }));
  }

  async guardianView(ctx: GuardianAuthContext, studentId: string, invoiceId: string) {
    return withTenant(ctx.schoolId, (db) => withGuardian(ctx.guardianId, studentId, db, async (tx) => {
      await this.invoice(tx, ctx.schoolId, invoiceId, studentId);
      return { policy: await this.policy(tx, ctx.schoolId), requests: await this.list(tx, ctx.schoolId, invoiceId, ctx.guardianId) };
    }));
  }

  async submit(ctx: GuardianAuthContext, studentId: string, invoiceId: string, schedule: CreateInstallmentInput[]) {
    return withTenant(ctx.schoolId, (db) => withGuardian(ctx.guardianId, studentId, db, async (tx) => {
      await this.lock(tx, ctx.schoolId, invoiceId);
      await this.validate(tx, ctx.schoolId, invoiceId, schedule, studentId);
      if (await tx.installmentRequest.findFirst({ where: {
        schoolId: ctx.schoolId, invoiceId, status: { in: ["PENDING", "COUNTERED"] },
      } })) throw new ConflictError("INSTALLMENT_REQUEST_OPEN", "An instalment request is already under review.");
      const request = await tx.installmentRequest.create({
        data: { schoolId: ctx.schoolId, invoiceId, guardianId: ctx.guardianId, schedule, status: "PENDING" },
      });
      await this.audit(tx, request, ctx.guardianId);
      return this.dto(request);
    }));
  }

  async decide(ctx: AuthContext, invoiceId: string, requestId: string, decision: InstallmentRequestDecision) {
    await assertUserActiveAndHasOneOf(ctx, ["owner", "admin", "bursar"]);
    const result = await withTenant(ctx.schoolId, async (db) => {
      await this.lock(db, ctx.schoolId, invoiceId);
      const request = await this.request(db, ctx.schoolId, invoiceId, requestId, decision.revision);
      let dto: InstallmentRequestDto;
      if (decision.action === "REJECT") {
        dto = await this.update(db, request, ctx.userId, "REJECTED");
      } else {
        if (request.status !== "PENDING") throw new ConflictError("INSTALLMENT_REQUEST_CHANGED", "The guardian must respond to the counter-offer.");
        if (decision.action === "COUNTER") {
          await this.validate(db, ctx.schoolId, invoiceId, decision.schedule);
          dto = await this.update(db, request, ctx.userId, "COUNTERED", decision.schedule);
        } else {
          dto = await this.approve(db, request, ctx.userId);
        }
      }
      return { dto, guardianId: request.guardianId };
    });
    await this.events?.installmentRequestUpdated({
      schoolId: ctx.schoolId, guardianId: result.guardianId, requestId, revision: result.dto.revision,
    });
    return result.dto;
  }

  async respond(ctx: GuardianAuthContext, studentId: string, invoiceId: string, requestId: string, revision: number, accept: boolean) {
    return withTenant(ctx.schoolId, (db) => withGuardian(ctx.guardianId, studentId, db, async (tx) => {
      await this.lock(tx, ctx.schoolId, invoiceId);
      await this.invoice(tx, ctx.schoolId, invoiceId, studentId);
      const request = await this.request(tx, ctx.schoolId, invoiceId, requestId, revision);
      if (request.guardianId !== ctx.guardianId) throw new NotFoundError("Instalment request not found.");
      if (request.status !== "COUNTERED") throw new ConflictError("INSTALLMENT_REQUEST_CHANGED", "This counter-offer is no longer available.");
      if (!accept) return this.update(tx, request, ctx.guardianId, "REJECTED");
      return this.approve(tx, request, ctx.guardianId);
    }));
  }

  private async lock(db: PrismaClient, schoolId: string, invoiceId: string) {
    await db.$queryRaw`SELECT id FROM invoices WHERE school_id = ${schoolId} AND id = ${invoiceId} FOR UPDATE`;
  }

  private async invoice(db: PrismaClient, schoolId: string, invoiceId: string, studentId?: string) {
    const invoice = await db.invoice.findFirst({ where: { id: invoiceId, schoolId, studentId }, select: {
      id: true, termId: true, status: true, totalDue: true, totalPaid: true, paymentPlans: { select: { id: true } },
    } });
    if (!invoice) throw new NotFoundError("Invoice not found.");
    return invoice;
  }

  private async validate(db: PrismaClient, schoolId: string, invoiceId: string, schedule: CreateInstallmentInput[], studentId?: string) {
    const invoice = await this.invoice(db, schoolId, invoiceId, studentId);
    const policy = await this.policy(db, schoolId);
    if (!policy.enabled || invoice.paymentPlans.length || !["ISSUED", "PARTIALLY_PAID"].includes(invoice.status)) {
      throw new ConflictError("INSTALLMENT_REQUEST_UNAVAILABLE", "This invoice is not eligible for an instalment request.");
    }
    const term = policy.requireWithinTerm ? await db.term.findFirst({ where: { id: invoice.termId, schoolId }, select: { endDate: true } }) : null;
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const invalidAmount = schedule.reduce((sum, installment) => sum + BigInt(installment.amount), 0n) !== BigInt(invoice.totalDue);
    if (invalidAmount || schedule.length > policy.maxInstallments ||
        Math.max(0, (schedule[0]?.amount ?? 0) - invoice.totalPaid) < policy.minimumFirstKobo ||
        (policy.requireWithinTerm && !term) ||
        schedule.some((item, i) => item.dueDate < today || (i > 0 && item.dueDate <= schedule[i - 1]!.dueDate) ||
          (term !== null && item.dueDate > term.endDate.toISOString().slice(0, 10)))) {
      throw new ConflictError("INSTALLMENT_POLICY_MISMATCH", "Use amounts totalling the invoice and increasing due dates within the school's instalment policy.");
    }
  }

  private async request(db: PrismaClient, schoolId: string, invoiceId: string, id: string, revision: number) {
    const request = await db.installmentRequest.findFirst({ where: { id, schoolId, invoiceId } });
    if (!request) throw new NotFoundError("Instalment request not found.");
    if (request.revision !== revision || !["PENDING", "COUNTERED"].includes(request.status)) {
      throw new ConflictError("INSTALLMENT_REQUEST_CHANGED", "Reload the request for its current version.");
    }
    return request;
  }

  private async list(db: PrismaClient, schoolId: string, invoiceId: string, guardianId?: string) {
    return (await db.installmentRequest.findMany({
      where: { schoolId, invoiceId, guardianId }, orderBy: { createdAt: "desc" }, take: 20,
    })).map((row) => this.dto(row));
  }

  private dto(row: { id: string; invoiceId: string; status: string; schedule: unknown; revision: number }): InstallmentRequestDto {
    return { id: row.id, invoiceId: row.invoiceId, status: row.status, schedule: installmentProposalSchema.parse(row.schedule), revision: row.revision };
  }

  private async approve(db: PrismaClient, request: Awaited<ReturnType<InstallmentRequestsService["request"]>>, actor: string) {
    const schedule = installmentProposalSchema.parse(request.schedule);
    await this.validate(db, request.schoolId, request.invoiceId, schedule);
    await this.plans.createInTransaction(db, { schoolId: request.schoolId, userId: actor }, {
      invoiceId: request.invoiceId, name: "Agreed instalment plan", installments: schedule,
    });
    return this.update(db, request, actor, "APPROVED");
  }

  private async update(db: PrismaClient, request: Awaited<ReturnType<InstallmentRequestsService["request"]>>, actor: string, status: string, schedule?: CreateInstallmentInput[]) {
    const updated = await db.installmentRequest.update({
      where: { id: request.id }, data: { status, revision: { increment: 1 }, ...(schedule ? { schedule } : {}) },
    });
    await this.audit(db, updated, actor);
    return this.dto(updated);
  }

  private async audit(db: PrismaClient, row: Awaited<ReturnType<InstallmentRequestsService["request"]>>, actor: string) {
    await db.auditLog.create({ data: {
      schoolId: row.schoolId, userId: actor, action: "installment-request." + row.status.toLowerCase(),
      entityType: "installment_request", entityId: row.id,
      metadata: { invoiceId: row.invoiceId, revision: row.revision, schedule: installmentProposalSchema.parse(row.schedule) },
    } });
  }
}
