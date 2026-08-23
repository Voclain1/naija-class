import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type PaymentLinkStateDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { PaystackService } from "../../common/paystack/paystack.service.js";

interface RequestContext {
  ipAddress: string | null;
}

const ACTIVE_STATUSES = ["CREATING", "LIVE"] as const;
// Paystack's hosted Payment Request page greets the payer with customer.email
// even when first_name/last_name are populated. Keep this synthetic and
// deliberately human-readable: a per-link UUID here is parent-visible.
const PAYMENT_LINK_CUSTOMER_EMAIL = "parent@schoolkit.ng";

@Injectable()
export class PaymentLinksService {
  constructor(private readonly paystack: PaystackService) {}

  async get(authCtx: AuthContext, invoiceId: string): Promise<PaymentLinkStateDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const invoice = await db.invoice.findFirst({
        where: { id: invoiceId, schoolId: authCtx.schoolId },
        select: { id: true, studentId: true },
      });
      if (!invoice) throw new NotFoundError("Invoice not found.");
      const studentLabel = await findStudentLabel(db, authCtx.schoolId, invoice.studentId);

      const school = await db.school.findUnique({
        where: { id: authCtx.schoolId },
        select: {
          name: true,
          paystackPaymentsEnabled: true,
          paystackSubaccountCode: true,
          paystackSplitCode: true,
        },
      });
      if (
        !school?.paystackPaymentsEnabled ||
        !school.paystackSubaccountCode ||
        !school.paystackSplitCode
      ) {
        return { state: "CONNECT_PAYSTACK" };
      }

      const active = await db.paymentLink.findFirst({
        where: { schoolId: authCtx.schoolId, invoiceId, status: { in: [...ACTIVE_STATUSES] } },
        orderBy: { createdAt: "desc" },
      });
      if (active?.status === "CREATING") return { state: "CREATING" };
      if (active?.status === "LIVE") return toLiveDto(active, school.name, studentLabel);

      const failed = await db.paymentLink.findFirst({
        where: { schoolId: authCtx.schoolId, invoiceId, status: "CREATE_FAILED" },
        orderBy: { createdAt: "desc" },
        select: { failureCode: true },
      });
      return failed
        ? { state: "RETRYABLE_FAILURE", failureCode: failed.failureCode }
        : { state: "NOT_CREATED" };
    });
  }

  async create(
    authCtx: AuthContext,
    invoiceId: string,
    reqCtx: RequestContext,
  ): Promise<PaymentLinkStateDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "bursar"]);

    const prepared = await withTenant(authCtx.schoolId, async (db) => {
      const invoice = await db.invoice.findFirst({
        where: { id: invoiceId, schoolId: authCtx.schoolId },
        select: { id: true, studentId: true, totalDue: true, totalPaid: true, status: true },
      });
      if (!invoice) throw new NotFoundError("Invoice not found.");
      const studentLabel = await findStudentLabel(db, authCtx.schoolId, invoice.studentId);
      if (["PAID", "CANCELLED", "REFUNDED"].includes(invoice.status)) {
        throw new ConflictError(
          "PAYMENT_LINK_INVOICE_NOT_PAYABLE",
          "A payment link cannot be created for this invoice status.",
        );
      }
      const amount = invoice.totalDue - invoice.totalPaid;
      if (amount <= 0) {
        throw new ConflictError(
          "PAYMENT_LINK_NO_BALANCE",
          "This invoice has no outstanding balance.",
        );
      }
      const school = await db.school.findUnique({
        where: { id: authCtx.schoolId },
        select: {
          name: true,
          paystackPaymentsEnabled: true,
          paystackSubaccountCode: true,
          paystackSplitCode: true,
        },
      });
      if (
        !school?.paystackPaymentsEnabled ||
        !school.paystackSubaccountCode ||
        !school.paystackSplitCode
      ) {
        throw new ConflictError(
          "PAYSTACK_NOT_CONFIGURED",
          "Connect Paystack before creating a payment link.",
        );
      }

      try {
        const link = await db.paymentLink.create({
          data: {
            schoolId: authCtx.schoolId,
            invoiceId,
            amount,
            createdBy: authCtx.userId,
          },
        });
        return { link, splitCode: school.paystackSplitCode, schoolName: school.name, studentLabel };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
        const existing = await db.paymentLink.findFirst({
          where: {
            schoolId: authCtx.schoolId,
            invoiceId,
            status: { in: [...ACTIVE_STATUSES] },
          },
          orderBy: { createdAt: "desc" },
        });
        if (!existing) throw error;
        return { existing, schoolName: school.name, studentLabel } as const;
      }
    });

    const existing = "existing" in prepared ? prepared.existing : undefined;
    if (existing) {
      return existing.status === "LIVE"
        ? toLiveDto(existing, prepared.schoolName, prepared.studentLabel)
        : { state: "CREATING" };
    }
    const link = prepared.link;
    if (!link) throw new Error("Payment link reservation was not returned");

    const syntheticEmail = PAYMENT_LINK_CUSTOMER_EMAIL;
    let requestCode: string | undefined;
    try {
      const customer = await this.paystack.createCustomer({
        email: syntheticEmail,
        firstName: "Parent",
        lastName: "School Fees",
      });
      await withTenant(authCtx.schoolId, (db) =>
        db.paymentLink.update({
          where: { id: link.id },
          data: { paystackCustomerCode: customer.customer_code, lastAttemptAt: new Date() },
        }),
      );

      const metadata = {
        schoolKitPaymentLinkId: link.id,
        schoolId: authCtx.schoolId,
        invoiceId,
      };
      const created = await this.paystack.createPaymentRequest({
        customerCode: customer.customer_code,
        amount: link.amount,
        description: `${prepared.schoolName} invoice payment`,
        splitCode: prepared.splitCode,
        metadata,
      });
      requestCode = created.request_code;
      const fetched = await this.paystack.getPaymentRequest(created.request_code);
      if (
        fetched.archived ||
        fetched.amount !== link.amount ||
        fetched.currency !== "NGN" ||
        fetched.split_code !== prepared.splitCode ||
        fetched.customer.customer_code !== customer.customer_code ||
        fetched.customer.email !== syntheticEmail ||
        fetched.metadata?.schoolKitPaymentLinkId !== link.id ||
        fetched.metadata?.schoolId !== authCtx.schoolId ||
        fetched.metadata?.invoiceId !== invoiceId
      ) {
        throw new ConflictError(
          "PAYSTACK_PAYMENT_REQUEST_MISMATCH",
          "Paystack did not persist the required payment-link routing and correlation fields.",
        );
      }

      return withTenant(authCtx.schoolId, async (db) => {
        const hostedUrl = `https://paystack.com/pay/${fetched.request_code}`;
        const live = await db.paymentLink.update({
          where: { id: link.id },
          data: {
            requestId: BigInt(fetched.id),
            requestCode: fetched.request_code,
            hostedUrl,
            paystackCustomerCode: customer.customer_code,
            status: "LIVE",
            failureCode: null,
          },
        });
        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: "payment-link.create",
            entityType: "payment_link",
            entityId: live.id,
            ipAddress: reqCtx.ipAddress,
            metadata: { invoiceId, amount: live.amount, requestCode: live.requestCode },
          },
        });
        return toLiveDto(live, prepared.schoolName, prepared.studentLabel);
      });
    } catch (error) {
      if (requestCode) await this.paystack.archivePaymentRequest(requestCode).catch(() => undefined);
      await withTenant(authCtx.schoolId, (db) =>
        db.paymentLink.update({
          where: { id: link.id },
          data: {
            status: "CREATE_FAILED",
            failureCode: domainFailureCode(error),
            retryCount: { increment: 1 },
            lastAttemptAt: new Date(),
          },
        }),
      );
      throw error;
    }
  }

  async archive(
    authCtx: AuthContext,
    invoiceId: string,
    reqCtx: RequestContext,
  ): Promise<PaymentLinkStateDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "bursar"]);

    const link = await withTenant(authCtx.schoolId, async (db) => {
      const invoice = await db.invoice.findFirst({
        where: { id: invoiceId, schoolId: authCtx.schoolId },
        select: { id: true },
      });
      if (!invoice) throw new NotFoundError("Invoice not found.");

      const active = await db.paymentLink.findFirst({
        where: { schoolId: authCtx.schoolId, invoiceId, status: "LIVE" },
        orderBy: { createdAt: "desc" },
        select: { id: true, requestCode: true, hostedUrl: true },
      });
      if (!active?.requestCode || !active.hostedUrl) {
        throw new ConflictError(
          "PAYMENT_LINK_NOT_LIVE",
          "There is no live payment link to archive.",
        );
      }

      const reserved = await db.paymentLink.updateMany({
        where: { id: active.id, schoolId: authCtx.schoolId, invoiceId, status: "LIVE" },
        data: { status: "ARCHIVE_PENDING", hostedUrl: null, lastAttemptAt: new Date() },
      });
      if (reserved.count !== 1) {
        throw new ConflictError(
          "PAYMENT_LINK_ARCHIVE_IN_PROGRESS",
          "This payment link is already being archived.",
        );
      }
      return {
        id: active.id,
        requestCode: active.requestCode,
        hostedUrl: active.hostedUrl,
      };
    });

    try {
      await this.paystack.archivePaymentRequest(link.requestCode);
    } catch (error) {
      await withTenant(authCtx.schoolId, (db) =>
        db.paymentLink.update({
          where: { id: link.id },
          data: {
            status: "LIVE",
            hostedUrl: link.hostedUrl,
            failureCode: "PAYSTACK_PAYMENT_REQUEST_ARCHIVE_FAILED",
            retryCount: { increment: 1 },
            lastAttemptAt: new Date(),
          },
        }),
      );
      throw error;
    }

    await withTenant(authCtx.schoolId, async (db) => {
      await db.paymentLink.update({
        where: { id: link.id },
        data: {
          status: "ARCHIVED",
          archivedAt: new Date(),
          hostedUrl: null,
          failureCode: null,
          lastAttemptAt: new Date(),
        },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: "payment-link.archive",
          entityType: "payment_link",
          entityId: link.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { invoiceId, requestCode: link.requestCode, reason: "manually-requested" },
        },
      });
    });
    return { state: "NOT_CREATED" };
  }
}

function domainFailureCode(error: unknown): string {
  if (typeof error === "object" && error && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 100);
  }
  return "PAYSTACK_PAYMENT_LINK_CREATE_FAILED";
}

function toLiveDto(row: {
  id: string;
  hostedUrl: string | null;
  requestCode: string | null;
  amount: number;
  currency: string;
  createdAt: Date;
}, schoolName: string, studentLabel: string): PaymentLinkStateDto {
  if (!row.hostedUrl || !row.requestCode || row.currency !== "NGN") {
    throw new ConflictError("PAYMENT_LINK_CORRUPT", "The stored payment link is incomplete.");
  }
  return {
    state: "LIVE",
    id: row.id,
    url: row.hostedUrl,
    amount: row.amount,
    currency: "NGN",
    schoolName,
    studentLabel,
    requestCode: row.requestCode,
    createdAt: row.createdAt.toISOString(),
  };
}

async function findStudentLabel(
  db: Parameters<Parameters<typeof withTenant>[1]>[0],
  schoolId: string,
  studentId: string,
): Promise<string> {
  const student = await db.student.findFirst({
    where: { id: studentId, schoolId },
    select: { firstName: true, lastName: true, admissionNumber: true },
  });
  return student
    ? `${student.firstName} ${student.lastName} (${student.admissionNumber})`
    : studentId;
}
