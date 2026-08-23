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
  ): Promise<number> {
    const links = await db.paymentLink.findMany({
      where: {
        schoolId,
        invoiceId,
        status: "LIVE",
        ...(exceptLinkId ? { id: { not: exceptLinkId } } : {}),
      },
      select: { id: true },
    });
    if (links.length === 0) return 0;
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
          await db.paymentLink.update({
            where: { id: link.id },
            data: {
              status: link.status === "PAID" ? "PAID" : "ARCHIVED",
              archivedAt: new Date(),
              hostedUrl: null,
              failureCode: null,
              lastAttemptAt: new Date(),
            },
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
