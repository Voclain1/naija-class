import { Injectable, Logger } from "@nestjs/common";

import { type PrismaClient, withTenant } from "@school-kit/db";

import { PaystackService } from "../../common/paystack/paystack.service.js";

@Injectable()
export class PaymentLinkInvalidationService {
  private readonly logger = new Logger(PaymentLinkInvalidationService.name);

  constructor(private readonly paystack: PaystackService) {}

  async markForArchive(
    db: PrismaClient,
    schoolId: string,
    invoiceId: string,
    exceptLinkId?: string,
    changedInstallmentId?: string | null,
  ): Promise<number> {
    const links = await db.paymentLink.findMany({
      where: {
        schoolId,
        invoiceId,
        status: "LIVE",
        ...(changedInstallmentId ? { OR: [{ installmentId: null }, { installmentId: changedInstallmentId }] } : {}),
        ...(exceptLinkId ? { id: { not: exceptLinkId } } : {}),
      },
      select: { id: true },
    });
    if (links.length === 0) return 0;
    await db.$executeRaw`UPDATE payment_links SET invalidated_at = COALESCE(invalidated_at, now())
      WHERE school_id = ${schoolId} AND id = ANY(${links.map(({ id }) => id)}::text[]) AND status = 'LIVE'`;
    await db.paymentLink.updateMany({
      where: { id: { in: links.map(({ id }) => id) }, status: "LIVE" },
      data: { status: "ARCHIVE_PENDING", hostedUrl: null, lastAttemptAt: new Date() },
    });
    await db.auditLog.createMany({
      data: links.map(({ id }) => ({
        schoolId,
        userId: null,
        action: "payment-link.archive-pending",
        entityType: "payment_link",
        entityId: id,
        metadata: { invoiceId, reason: "invoice-balance-changed" },
      })),
    });
    return links.length;
  }

  async archivePending(schoolId: string, invoiceId?: string): Promise<void> {
    const links = await withTenant(schoolId, (db) =>
      db.paymentLink.findMany({
        where: {
          schoolId,
          ...(invoiceId ? { invoiceId } : {}),
          requestCode: { not: null },
          archivedAt: null,
          status: { in: ["ARCHIVE_PENDING", "PAID"] },
        },
        select: { id: true, invoiceId: true, requestCode: true, status: true },
      }),
    );

    for (const link of links) {
      if (!link.requestCode) continue;
      try {
        await this.paystack.archivePaymentRequest(link.requestCode);
        await withTenant(schoolId, async (db) => {
          const details = { archivedAt: new Date(), hostedUrl: null, failureCode: null, lastAttemptAt: new Date() };
          const archived = await db.paymentLink.updateMany({
            where: { id: link.id, schoolId, status: "ARCHIVE_PENDING" },
            data: { ...details, status: "ARCHIVED" },
          });
          if (!archived.count) await db.paymentLink.updateMany({
            where: { id: link.id, schoolId, status: "PAID" }, data: details,
          });
          await db.auditLog.create({
            data: {
              schoolId,
              userId: null,
              action: "payment-link.archive",
              entityType: "payment_link",
              entityId: link.id,
              metadata: { invoiceId: link.invoiceId, requestCode: link.requestCode },
            },
          });
        });
      } catch (error) {
        this.logger.error(`Payment-link archive failed for ${link.id}: ${String(error)}`);
        await withTenant(schoolId, (db) =>
          db.paymentLink.update({
            where: { id: link.id },
            data: {
              failureCode: "PAYSTACK_PAYMENT_REQUEST_ARCHIVE_FAILED",
              retryCount: { increment: 1 },
              lastAttemptAt: new Date(),
            },
          }),
        );
      }
    }
  }
}
