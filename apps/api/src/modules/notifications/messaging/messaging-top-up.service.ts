import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, InternalError, ValidationError, type MessagingTopUpCheckout } from "@school-kit/types";

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
  constructor(private readonly config: ConfigService, private readonly paystack: PaystackService) {}

  async checkout(auth: AuthContext, clientRequestId: string, amount: string): Promise<MessagingTopUpCheckout> {
    await assertUserActiveAndHasOneOf(auth, ["owner"]);
    const min = positiveKobo(this.config.get("MESSAGING_TOP_UP_MIN_KOBO"));
    const max = positiveKobo(this.config.get("MESSAGING_TOP_UP_MAX_KOBO"));
    if (this.config.get<string>("MESSAGING_TOP_UPS_ENABLED") !== "on" || min === null || max === null || max < min) {
      throw new ForbiddenError("Messaging top-ups are currently disabled.");
    }
    const amountKobo = positiveKobo(amount);
    if (amountKobo === null || amountKobo < min || amountKobo > max) {
      throw new ValidationError("Top-up amount is outside the configured range.");
    }
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
        return { checkout: { reference: previous.reference, checkoutUrl: previous.checkoutUrl } };
      }
      await db.messagingWalletTopUp.create({
        data: { reference, schoolId, clientRequestId, createdBy: userId, amountKobo: Number(amountKobo) },
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
    return { reference, checkoutUrl: url.href };
  }

  /** Invoked by the signed Paystack webhook for charge.success. Amount is verified with Paystack. */
  async acceptVerifiedCharge(reference: string): Promise<void> {
    const schoolId = TOP_UP_REFERENCE.exec(reference)?.[1];
    if (!schoolId) return;
    const pending = await withTenant(schoolId, async (db) => {
      const topUp = await db.messagingWalletTopUp.findFirst({ where: { schoolId, reference } });
      if (!topUp) return null;
      const credited = await db.messagingWalletEntry.count({ where: { schoolId, reference, kind: "TOP_UP" } });
      return credited > 0 ? null : topUp;
    }, { label: "messaging-top-up-lookup" });
    if (!pending) return;
    const verified = await this.paystack.verifyTransaction(reference);
    const metadata = verified.metadata as { purpose?: unknown; schoolId?: unknown } | null;
    if (verified.status !== "success" || verified.reference !== reference || verified.currency !== "NGN" ||
        verified.amount !== pending.amountKobo || !verified.paid_at ||
        metadata?.schoolId !== schoolId || metadata.purpose !== "messaging-wallet-top-up" || verified.split?.split_code) return;
    const result = await creditVerifiedMessagingTopUp(schoolId, reference, BigInt(pending.amountKobo));
    if (result === "CONFLICT") throw new InternalError("MESSAGING_TOP_UP_CONFLICT", "Messaging top-up requires reconciliation.");
  }
}
