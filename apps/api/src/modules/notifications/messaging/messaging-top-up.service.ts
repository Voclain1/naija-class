import { randomUUID } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, InternalError, ValidationError, type Kobo, type MessagingTopUpAvailability, type MessagingTopUpQuote, type MessagingTopUpCheckout } from "@school-kit/types";

import type { AuthContext } from "../../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../../common/auth/role-check";
import { PaystackService } from "../../../common/paystack/paystack.service";
import { creditVerifiedMessagingTopUp } from "./messaging-wallet";

const UUID_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const TOP_UP_REFERENCE = new RegExp(`^mwallet-(${UUID_PART})-${UUID_PART}$`, "i");
const MAX_AMOUNT = 2_147_483_647n;

function positiveKobo(value: unknown): bigint | null {
  return typeof value === "string" && /^[1-9]\d{0,9}$/.test(value) && BigInt(value) <= MAX_AMOUNT ? BigInt(value) : null;
}

@Injectable()
export class MessagingTopUpService {
  private cursor: string | undefined;
  private readonly logger = new Logger(MessagingTopUpService.name);
  constructor(private readonly config: ConfigService, private readonly paystack: PaystackService) {}

  availability(): MessagingTopUpAvailability {
    const min = positiveKobo(this.config.get("MESSAGING_TOP_UP_MIN_KOBO"));
    const max = positiveKobo(this.config.get("MESSAGING_TOP_UP_MAX_KOBO"));
    const fee = this.config.get<string>("MESSAGING_TOP_UP_ESTIMATED_FEE_KOBO");
    const estimated = fee === "0" ? 0n : positiveKobo(fee);
    return {
      available: this.config.get("MESSAGING_TOP_UPS_ENABLED") === "on" && min !== null && max !== null &&
        max >= min && estimated !== null && min > estimated,
      minKobo: min === null ? null : String(min) as Kobo,
      maxKobo: max === null ? null : String(max) as Kobo,
      estimatedFeeKobo: estimated === null ? null : String(estimated) as Kobo,
    };
  }

  quote(amount: string): MessagingTopUpQuote {
    const { available, minKobo, maxKobo, estimatedFeeKobo } = this.availability();
    if (!available || minKobo === null || maxKobo === null || estimatedFeeKobo === null) {
      throw new ForbiddenError("Messaging top-ups are currently disabled.");
    }
    const amountKobo = positiveKobo(amount);
    if (amountKobo === null || amountKobo < BigInt(minKobo) || amountKobo > BigInt(maxKobo)) {
      throw new ValidationError("Top-up amount is outside the configured range.");
    }
    return this.quoteAmounts(amountKobo, BigInt(estimatedFeeKobo));
  }

  private quoteAmounts(amount: bigint, fee: bigint): MessagingTopUpQuote {
    return {
      amountKobo: String(amount) as Kobo, estimatedFeeKobo: String(fee) as Kobo,
      expectedCreditKobo: String(amount - fee) as Kobo,
    };
  }

  async recover(auth: AuthContext, reference: string): Promise<void> {
    await assertUserActiveAndHasOneOf(auth, ["owner"]);
    if (TOP_UP_REFERENCE.exec(reference)?.[1] !== auth.schoolId) throw new ForbiddenError("Top-up is unavailable.");
    await this.acceptVerifiedCharge(reference);
  }

  async checkout(auth: AuthContext, clientRequestId: string, amount: string): Promise<MessagingTopUpCheckout> {
    await assertUserActiveAndHasOneOf(auth, ["owner"]);
    const quote = this.quote(amount);
    const amountKobo = BigInt(quote.amountKobo);
    const { schoolId, userId } = auth;
    const reference = `mwallet-${schoolId}-${randomUUID()}`;

    const prepared = await withTenant(schoolId, async (db) => {
      const [school] = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM schools WHERE id = ${schoolId} AND suspended_at IS NULL
            AND deletion_started_at IS NULL AND status = 'ACTIVE' FOR UPDATE`;
      if (!school) throw new ForbiddenError("Messaging top-ups are unavailable for this school.");
      const user = await db.user.findFirst({
        where: { schoolId, id: userId, isActive: true, emailVerified: true },
        select: { email: true },
      });
      if (!user?.email) throw new ForbiddenError("Verify the owner's email before starting a top-up.");
      const previous = await db.messagingWalletTopUp.findFirst({ where: { schoolId, clientRequestId } });
      if (previous) {
        if (previous.createdBy !== userId || BigInt(previous.amountKobo) !== amountKobo || !previous.checkoutUrl) {
          throw new ConflictError("MESSAGING_TOP_UP_CONFLICT", "This top-up request is unavailable.");
        }
        return {
          checkout: {
            reference: previous.reference, checkoutUrl: previous.checkoutUrl,
            ...(previous.estimatedFeeKobo === null ? {} : { quote: this.quoteAmounts(amountKobo, BigInt(previous.estimatedFeeKobo)) }),
          },
        };
      }
      await db.messagingWalletTopUp.create({
        data: { reference, schoolId, clientRequestId, createdBy: userId, amountKobo: Number(amountKobo), estimatedFeeKobo: Number(quote.estimatedFeeKobo) },
      });
      await db.auditLog.create({
        data: {
          schoolId, userId, action: "messaging-wallet.top-up-start",
          entityType: "messaging_wallet_top_up", entityId: reference,
          metadata: { amountKobo: amountKobo.toString() },
        },
      });
      return { email: user.email };
    }, { label: "messaging-top-up-start" });

    if (prepared.checkout) return prepared.checkout;
    const response = await this.paystack.initializeTransaction({
      reference, amount: Number(amountKobo), email: prepared.email,
      metadata: { purpose: "messaging-wallet-top-up", schoolId },
    });
    let url: URL;
    try {
      url = new URL(response.authorization_url);
    } catch {
      throw new InternalError("MESSAGING_TOP_UP_CHECKOUT_INVALID", "Paystack returned an invalid top-up checkout.");
    }
    if (response.reference !== reference || url.origin !== "https://checkout.paystack.com" || url.username || url.password) {
      throw new InternalError("MESSAGING_TOP_UP_CHECKOUT_INVALID", "Paystack returned an invalid top-up checkout.");
    }
    await withTenant(schoolId, (db) => db.messagingWalletTopUp.updateMany({
      where: { schoolId, reference },
      data: { checkoutUrl: url.href },
    }));
    return { reference, checkoutUrl: url.href, quote };
  }

  @Cron("*/5 * * * *", { waitForCompletion: true })
  async recoverPendingTopUps(): Promise<void> {
    if (this.config.get("MESSAGING_TOP_UP_RECOVERY_ENABLED") !== "on") return;
    const schools = await basePrisma.school.findMany({
      where: { deletionStartedAt: null, ...(this.cursor && { id: { gt: this.cursor } }) },
      select: { id: true }, orderBy: { id: "asc" }, take: 20,
    });
    this.cursor = schools.length === 20 ? schools.at(-1)?.id : undefined;
    const now = new Date();
    for (const { id: schoolId } of schools) {
      const outstanding = await withTenant(schoolId, (db) => db.messagingWalletTopUp.findMany({
        where: {
          schoolId, verifiedAt: null, recoveryAttempts: { lt: 12 },
          createdAt: { lte: new Date(now.getTime() - 5 * 60_000) },
          OR: [{ nextRecoveryAt: null }, { nextRecoveryAt: { lte: now } }],
        },
        select: { reference: true, recoveryAttempts: true }, orderBy: { createdAt: "asc" }, take: 5,
      }));
      for (const { reference, recoveryAttempts } of outstanding) {
        const attempt = recoveryAttempts + 1;
        const claimed = await withTenant(schoolId, (db) => db.messagingWalletTopUp.updateMany({
          where: { schoolId, reference, verifiedAt: null, recoveryAttempts },
          data: {
            recoveryAttempts: attempt,
            nextRecoveryAt: new Date(now.getTime() + Math.min(2 ** attempt * 60_000, 6 * 3_600_000)),
          },
        }));
        if (!claimed.count) continue;
        try {
          await this.acceptVerifiedCharge(reference);
        } catch {
          this.logger.warn("Messaging top-up verification did not complete");
        }
        if (attempt === 12) await withTenant(schoolId, (db) => db.messagingWalletTopUp.updateMany({
          where: { schoolId, reference, verifiedAt: null, reconciliationCode: null },
          data: { reconciliationCode: "VERIFICATION_RETRY_EXHAUSTED" },
        }));
      }
    }
  }

  /** Invoked by the signed Paystack webhook for charge.success. Amount is verified with Paystack. */
  async acceptVerifiedCharge(reference: string): Promise<void> {
    const schoolId = TOP_UP_REFERENCE.exec(reference)?.[1];
    if (!schoolId) return;
    const pending = await withTenant(schoolId, async (db) => {
      const topUp = await db.messagingWalletTopUp.findFirst({ where: { schoolId, reference } });
      if (!topUp) return null;
      const credited = await db.messagingWalletEntry.count({ where: { schoolId, reference, kind: "TOP_UP" } });
      return credited > 0 && topUp.verifiedAt ? null : topUp;
    }, { label: "messaging-top-up-lookup" });
    if (!pending) return;
    const verified = await this.paystack.verifyTransaction(reference);
    const metadata = verified.metadata as { purpose?: unknown; schoolId?: unknown } | null;
    if (verified.status !== "success") return;
    const matched = verified.reference === reference && verified.currency === "NGN" &&
      verified.amount === pending.amountKobo && !!verified.paid_at && metadata?.schoolId === schoolId &&
      metadata.purpose === "messaging-wallet-top-up" && !verified.split?.split_code;
    const fees = verified.fees;
    const validFee = typeof fees === "number" && Number.isSafeInteger(fees) && fees >= 0 && fees < pending.amountKobo;
    if (!matched || !validFee) {
      await withTenant(schoolId, (db) => db.messagingWalletTopUp.updateMany({
        where: { schoolId, reference, verifiedAt: null },
        data: { reconciliationCode: matched ? "FEES_UNVERIFIED" : "PROVIDER_MISMATCH" },
      }));
      return;
    }
    const credit = BigInt(pending.amountKobo) - BigInt(fees);
    const result = await creditVerifiedMessagingTopUp(schoolId, reference, credit);
    if (result === "CONFLICT") throw new InternalError("MESSAGING_TOP_UP_CONFLICT", "Messaging top-up requires reconciliation.");
    await withTenant(schoolId, (db) => db.messagingWalletTopUp.updateMany({
      where: { schoolId, reference, verifiedAt: null },
      data: { actualFeeKobo: fees, verifiedAt: new Date(), reconciliationCode: null },
    }));
  }
}
