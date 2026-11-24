import { createHash, randomUUID } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { basePrisma, Prisma } from "@school-kit/db";
import type { PaystackWebhookEvent } from "@school-kit/types";
import { z } from "zod";

import { MessagingTopUpService } from "../notifications/messaging/messaging-top-up.service";
import { PayrollService } from "../payroll/payroll.service.js";
import { PaymentsService } from "./payments.service.js";

const MAX_ATTEMPTS = 8;
const allowed = new Set(["charge.success", "charge.failed", "paymentrequest.success", "transfer.success", "transfer.failed", "transfer.reversed"]);
const reference = z.string().regex(/^[A-Za-z0-9_.=-]{1,220}$/);
const envelope = z.object({
  event: z.string().max(80),
  data: z.object({
    reference: reference.optional(),
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

@Injectable()
export class PaystackWebhookInboxService {
  private readonly logger = new Logger(PaystackWebhookInboxService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly payments: PaymentsService,
    private readonly payroll: PayrollService,
    private readonly topUps: MessagingTopUpService,
  ) {}

  private mode(): "live" | "test" | "legacy" {
    const explicit = this.config.get<string>("PAYSTACK_WEBHOOK_MODE");
    if (explicit === "live" || explicit === "test") return explicit;
    const key = this.config.get<string>("PAYSTACK_SECRET_KEY");
    if (key?.startsWith("sk_live_")) return "live";
    if (key?.startsWith("sk_test_")) return "test";
    return "legacy";
  }

  async capture(input: unknown): Promise<void> {
    const decoded = envelope.safeParse(input);
    if (!decoded.success || !allowed.has(decoded.data.event)) return;
    const { event, data } = decoded.data;
    const mode = this.mode();
    if (data.domain && mode !== "legacy" && data.domain !== mode) return;
    if (event !== "paymentrequest.success" && !data.reference) return;
    const stable = {
      event,
      data: {
        reference: data.reference ?? "", status: data.status ?? "", amount: data.amount ?? 0, paid_at: data.paid_at ?? null,
        ...(data.currency && { currency: data.currency }),
        ...(event === "paymentrequest.success" && { metadata: data.metadata ?? null, transaction: data.transaction ?? null }),
      },
    };
    const eventKey = createHash("sha256").update(JSON.stringify(stable)).digest("hex");
    await basePrisma.paystackWebhookInbox.createMany({
      skipDuplicates: true,
      data: { mode, eventKey, eventType: event, payload: stable },
    });
  }

  @Cron("*/10 * * * * *", { waitForCompletion: true })
  async processPending(): Promise<void> {
    const mode = this.mode();
    await basePrisma.paystackWebhookInbox.updateMany({
      where: {
        mode, attempts: { gte: MAX_ATTEMPTS }, processedAt: null, deadAt: null, claimedUntil: { lte: new Date() },
      },
      data: { deadAt: new Date(), claimId: null, claimedUntil: null },
    });
    for (let index = 0; index < 5; index++) {
      const claim = randomUUID();
      const [row] = await basePrisma.$queryRaw<{ event_key: string; payload: PaystackWebhookEvent; attempts: number }[]>`
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
        RETURNING i.event_key, i.payload, i.attempts`;
      if (!row) return;
      const where = { mode, eventKey: row.event_key, claimId: claim };
      try {
        await this.dispatch(row.payload);
        await basePrisma.paystackWebhookInbox.updateMany({
          where, data: { processedAt: new Date(), payload: Prisma.DbNull, claimId: null, claimedUntil: null },
        });
      } catch {
        this.logger.warn("Paystack webhook processing failed; durable retry scheduled or dead-lettered");
        await basePrisma.paystackWebhookInbox.updateMany({
          where,
          data: {
            claimId: null, claimedUntil: null,
            ...(row.attempts >= MAX_ATTEMPTS ? { deadAt: new Date() }
              : { nextAttemptAt: new Date(Date.now() + Math.min(2 ** row.attempts * 10_000, 3_600_000)) }),
          },
        });
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
