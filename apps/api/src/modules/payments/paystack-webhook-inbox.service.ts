import { createHash, randomUUID } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { basePrisma, Prisma } from "@school-kit/db";
import { ConflictError, type PaystackWebhookDeadLetterPage, type PaystackWebhookEvent } from "@school-kit/types";
import { z } from "zod";

import { paystackWebhookMode } from "../../common/paystack/paystack-webhook-mode.js";
import { MessagingTopUpService } from "../notifications/messaging/messaging-top-up.service";
import { PayrollService } from "../payroll/payroll.service.js";
import { PaymentsService } from "./payments.service.js";

const MAX_ATTEMPTS = 8;
const requiresFinancialReview = new Set([
  "refund.pending", "refund.processing", "refund.processed", "refund.failed",
  "charge.dispute.create", "charge.dispute.remind", "charge.dispute.resolve",
]);
const allowed = new Set([...requiresFinancialReview, "charge.success", "charge.failed", "paymentrequest.success", "transfer.success", "transfer.failed", "transfer.reversed"]);
const reference = z.string().regex(/^[A-Za-z0-9_.=-]{1,220}$/);
const envelope = z.object({
  event: z.string().max(80),
  data: z.object({
    reference: reference.optional(),
    id: z.number().int().positive().safe().optional().catch(undefined),
    request_code: z.string().regex(/^PRQ_[A-Za-z0-9_-]{1,120}$/).optional().catch(undefined),
    status: z.string().max(40).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    amount: z.number().int().nonnegative().safe().optional(),
    paid_at: z.string().datetime({ offset: true }).nullable().optional(),
    domain: z.enum(["test", "live"]).optional(),
    metadata: z.object({
      schoolId: z.string().uuid().optional(),
      schoolKitPaymentLinkId: z.string().uuid().optional(),
      invoiceId: z.string().uuid().optional(),
    }).nullish().catch(undefined),
    transaction: z.object({ reference: reference.optional() }).nullish().catch(undefined),
  }),
});

// Provider ingress is platform-scoped. Ordinary tenant transactions never
// set this flag. Every access goes through a transaction-local setting.
export function withPaystackWebhookInbox<T>(fn: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return basePrisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT set_config('app.paystack_webhook_inbox', 'on', true)`;
    return fn(db);
  });
}

@Injectable()
export class PaystackWebhookInboxService {
  private readonly logger = new Logger(PaystackWebhookInboxService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly payments: PaymentsService,
    private readonly payroll: PayrollService,
    private readonly topUps: MessagingTopUpService,
  ) {}

  async capture(input: unknown): Promise<void> {
    const decoded = envelope.safeParse(input);
    if (!decoded.success || !allowed.has(decoded.data.event)) {
      this.logger.warn("Paystack webhook ignored: unsupported event or invalid projection");
      return;
    }
    const { event, data } = decoded.data;
    const mode = paystackWebhookMode(this.config);
    if ((data.domain && mode !== "legacy" && data.domain !== mode) ||
        (event !== "paymentrequest.success" && !requiresFinancialReview.has(event) && !data.reference)) {
      this.logger.warn("Paystack webhook ignored: incorrect mode or missing correlation");
      return;
    }
    const stable = {
      event,
      data: {
        reference: data.reference ?? "", status: data.status ?? "", amount: data.amount ?? 0, paid_at: data.paid_at ?? null,
        ...(data.currency && { currency: data.currency }),
        ...(event === "paymentrequest.success" && { metadata: data.metadata ?? null, transaction: data.transaction ?? null }),
        ...(event === "paymentrequest.success" && data.request_code && { request_code: data.request_code }),
        ...(requiresFinancialReview.has(event) && { transaction: data.transaction ?? null }),
      },
    };
    // Paystack's data.id identifies the underlying resource. Include the
    // event type and reference so its separate transitions remain distinct.
    const identity = data.id === undefined ? stable : {
      event, resourceId: data.id, reference: data.reference ?? null, transaction: data.transaction?.reference ?? null,
    };
    const eventKey = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    await withPaystackWebhookInbox((db) => db.paystackWebhookInbox.createMany({
      skipDuplicates: true,
      data: {
        mode, eventKey, eventType: event, payload: { ...stable, data: { ...stable.data, ...(data.id && { id: data.id }) } },
        ...(requiresFinancialReview.has(event) && { deadAt: new Date() }),
      },
    }));
  }

  async listDeadLetters(): Promise<PaystackWebhookDeadLetterPage> {
    const rows = await withPaystackWebhookInbox((db) => db.paystackWebhookInbox.findMany({
      where: { mode: paystackWebhookMode(this.config), deadAt: { not: null }, processedAt: null },
      orderBy: [{ deadAt: "desc" }, { eventKey: "asc" }],
      take: 101,
      select: { eventKey: true, eventType: true, attempts: true, receivedAt: true, deadAt: true, payload: true },
    }));
    return {
      items: rows.slice(0, 100).map(({ payload, ...row }) => {
        const decoded = envelope.safeParse(payload);
        const data = decoded.success ? decoded.data.data : null;
        return {
          ...row, receivedAt: row.receivedAt.toISOString(), deadAt: row.deadAt!.toISOString(),
          reference: data?.transaction?.reference ?? data?.reference ?? null,
          providerResourceId: data?.id ?? null,
          requiresFinancialReview: requiresFinancialReview.has(row.eventType),
        };
      }),
      truncated: rows.length > 100,
    };
  }

  async replayDeadLetter(eventKey: string, userId: string, evidenceRef: string) {
    const mode = paystackWebhookMode(this.config);
    await withPaystackWebhookInbox(async (db) => {
      const result = await db.paystackWebhookInbox.updateMany({
        where: { mode, eventKey, deadAt: { not: null }, processedAt: null, payload: { not: Prisma.DbNull }, eventType: { notIn: [...requiresFinancialReview] } },
        data: { deadAt: null, claimId: null, claimedUntil: null, attempts: 0, nextAttemptAt: new Date() },
      });
      if (!result.count) throw new ConflictError("WEBHOOK_NOT_REPLAYABLE", "This event has no dead-letter payload available to replay.");
      await db.auditLog.create({
        data: {
          userId, action: "payments.webhook.replay", entityType: "paystack_webhook_inbox", entityId: eventKey,
          metadata: { mode, evidenceRef },
        },
      });
    });
    return { eventKey, status: "QUEUED" as const };
  }

  @Cron("*/10 * * * * *", { waitForCompletion: true })
  async processPending(): Promise<void> {
    const mode = paystackWebhookMode(this.config);
    await withPaystackWebhookInbox((db) => db.paystackWebhookInbox.updateMany({
      where: {
        mode, attempts: { gte: MAX_ATTEMPTS }, processedAt: null, deadAt: null, claimedUntil: { lte: new Date() },
      },
      data: { deadAt: new Date(), claimId: null, claimedUntil: null },
    }));
    for (let index = 0; index < 5; index++) {
      const claim = randomUUID();
      const [row] = await withPaystackWebhookInbox((db) => db.$queryRaw<{ event_key: string; payload: PaystackWebhookEvent; attempts: number }[]>`
        WITH next AS (
          SELECT event_key FROM paystack_webhook_inbox
          WHERE mode = ${mode} AND processed_at IS NULL AND dead_at IS NULL AND next_attempt_at <= NOW()
            AND attempts < ${MAX_ATTEMPTS}
            AND (claimed_until IS NULL OR claimed_until <= NOW())
          ORDER BY next_attempt_at, received_at, event_key LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        UPDATE paystack_webhook_inbox i
        SET claim_id = ${claim}, claimed_until = NOW() + INTERVAL '15 minutes', attempts = i.attempts + 1
        FROM next WHERE i.mode = ${mode} AND i.event_key = next.event_key
        RETURNING i.event_key, i.payload, i.attempts`);
      if (!row) return;
      const where = { mode, eventKey: row.event_key, claimId: claim };
      try {
        await this.dispatch(row.payload);
        await withPaystackWebhookInbox((db) => db.paystackWebhookInbox.updateMany({
          where, data: { processedAt: new Date(), payload: Prisma.DbNull, claimId: null, claimedUntil: null },
        }));
      } catch {
        this.logger.warn("Paystack webhook processing failed; durable retry scheduled or dead-lettered");
        await withPaystackWebhookInbox((db) => db.paystackWebhookInbox.updateMany({
          where,
          data: {
            claimId: null, claimedUntil: null,
            ...(row.attempts >= MAX_ATTEMPTS ? { deadAt: new Date() }
              : { nextAttemptAt: new Date(Date.now() + Math.min(2 ** row.attempts * 10_000, 3_600_000)) }),
          },
        }));
      }
    }
  }

  private async dispatch(event: PaystackWebhookEvent): Promise<void> {
    if (event.event === "paymentrequest.success") {
      await this.payments.handlePaymentRequestWebhook(event);
    } else if (event.event.startsWith("transfer.")) {
      await this.payroll.handleTransferWebhook(event);
    } else if (event.data.reference.startsWith("mwallet-")) {
      if (event.event === "charge.success") await this.topUps.acceptVerifiedCharge(event.data.reference);
    } else {
      await this.payments.handleWebhook(event);
    }
  }
}
