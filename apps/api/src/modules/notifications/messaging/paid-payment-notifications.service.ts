import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { withTenant, type NotificationDelivery } from "@school-kit/db";
import { formatKobo } from "@school-kit/types";

import { smsSenderFor } from "../../../common/termii/sms-sender";
import { TermiiService } from "../../../common/termii/termii.service";
import { NotificationPreferencesService } from "../notification-preferences.service";
import { isQuietHour } from "../quiet-hours";
import { GuardianMessagingConsentService } from "./guardian-messaging-consent.service";
import { countSmsSegments, quoteDispatchCost } from "./messaging-pricing";
import { reserveMessagingCredit, resolveMessagingCredit } from "./messaging-wallet";
import { MetaConnectionsService } from "./meta-connections.service";
import { sendMetaTemplate } from "./meta-provider";
import { readPaidMessagingProfiles, reviewedPaymentTemplate, type PaidMessagingProfile } from "./paid-messaging-policy";

export const PAID_PAYMENT_EVENT = "payment.confirmation-paid";

type Claimed = { state: "SENDING" | "BLOCKED" | "UNKNOWN" | "ACCEPTED"; reason?: string; accountId?: string; reference?: string };

@Injectable()
export class PaidPaymentNotificationsService {
  private readonly logger = new Logger(PaidPaymentNotificationsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly consent: GuardianMessagingConsentService,
    private readonly accounts: MetaConnectionsService,
    private readonly preferences: NotificationPreferencesService,
    private readonly termii: TermiiService,
  ) {}

  private profiles() {
    return readPaidMessagingProfiles(this.config.get("MESSAGING_PAID_ENABLED"), this.config.get("MESSAGING_PAID_PAYMENT_PROFILES"));
  }

  async queue(schoolId: string, paymentId: string): Promise<void> {
    const profile = this.profiles().find((item) => item.schoolId === schoolId);
    if (!profile) return;
    await withTenant(schoolId, async (db) => {
      const payment = await db.payment.findFirst({
        where: { schoolId, id: paymentId, method: "PAYSTACK", status: "SUCCESS", paidAt: { not: null } },
        select: { studentId: true },
      });
      if (!payment) return;
      const guardians = await db.studentGuardian.findMany({
        where: { schoolId, studentId: payment.studentId, guardian: { portalDisabledAt: null } },
        select: { guardianId: true },
      });
      await db.notificationDelivery.createMany({ skipDuplicates: true, data: guardians.map(({ guardianId }) => ({
        schoolId, eventId: paymentId, eventType: PAID_PAYMENT_EVENT, principalType: "GUARDIAN",
        principalId: guardianId, channel: profile.channel, dispatchState: "QUEUED",
      })) });
    });
  }

  @Cron("*/1 * * * *", { waitForCompletion: true })
  tick(): Promise<void> {
    return this.processPending(new Date());
  }

  async processPending(now: Date): Promise<void> {
    if (isQuietHour(now)) return;
    for (const profile of this.profiles()) {
      try {
        await this.processSchool(profile, now);
      } catch {
        this.logger.error("Could not process a paid notification batch");
      }
    }
  }

  private async processSchool(profile: PaidMessagingProfile, now: Date): Promise<void> {
    const { schoolId } = profile;
    const jobs = await withTenant(schoolId, async (db) => {
      await db.notificationDelivery.updateMany({
        where: {
          schoolId, eventType: PAID_PAYMENT_EVENT, dispatchState: "SENDING",
          dispatchClaimedAt: { lt: new Date(now.getTime() - 15 * 60_000) },
        },
        data: { dispatchState: "UNKNOWN", dispatchReason: "INTERRUPTED" },
      });
      return db.notificationDelivery.findMany({
        where: { schoolId, eventType: PAID_PAYMENT_EVENT, dispatchState: "QUEUED" },
        orderBy: { sentAt: "asc" }, take: 25,
      });
    });
    for (const job of jobs) {
      try {
        await this.process(job, profile, now);
      } catch {
        // After a crash or a provider call with an unknown result, there is
        // no resend. The durable SENDING lease later resolves to UNKNOWN.
        this.logger.warn("Paid notification did not finish; its claim remains durable");
      }
    }
  }

  private async process(job: NotificationDelivery, profile: PaidMessagingProfile, now: Date): Promise<void> {
    const { schoolId, principalId, channel } = job;
    const verified = () => this.consent.verifiedRecipient(schoolId, principalId);
    const preflight = await this.paymentFacts(job);
    const recipient = await verified();
    const template = channel === "WHATSAPP" ? reviewedPaymentTemplate(profile, now) : undefined;
    const account = template && await this.accounts.activeAccount(schoolId);
    const sms = channel === "SMS" && profile.termiiAccountId && this.termii.isConfigured &&
      (await this.preferences.getEnabledChannels(schoolId)).sms;
    const block = (reason: string) => this.finish(job, "QUEUED", { state: "BLOCKED", reason });
    if (channel !== profile.channel) return block("CHANNEL_CHANGED");
    if (!recipient?.startsWith("+234") || !preflight) return block("RECIPIENT_OR_PAYMENT_UNAVAILABLE");
    if (channel === "WHATSAPP" && (!template || !account || account.wabaId !== template.wabaId)) return block("TEMPLATE_OR_ACCOUNT_UNAVAILABLE");
    if (channel === "SMS" && !sms) return block("SMS_UNAVAILABLE");

    const priceKey = template ? `META_${template.category}` as const : "TERMII_SMS";
    const cost = quoteDispatchCost(profile.rates, priceKey, template ? "SCHOOL_OWNED" : "SCHOOLKIT",
      template ? 1 : countSmsSegments(preflight.sms), now);
    if (!cost || cost.estimatedKobo > 2_147_483_647n) return block("PRICE_MISSING");

    const claimed = await withTenant(schoolId, async (db) => {
      const [school] = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM schools WHERE id = ${schoolId} AND status = 'ACTIVE' AND suspended_at IS NULL
          AND deletion_started_at IS NULL FOR UPDATE`;
      if (!school) return "INACTIVE";
      if (channel === "WHATSAPP") {
        const [daily] = await db.$queryRaw<{ total: bigint }[]>`
          SELECT COALESCE(SUM(dispatch_estimate_kobo), 0) AS total FROM notification_deliveries
          WHERE school_id = ${schoolId} AND channel = 'WHATSAPP'
            AND dispatch_state IN ('SENDING', 'ACCEPTED', 'UNKNOWN')
            AND (dispatch_claimed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Lagos')::date =
              (${now}::timestamptz AT TIME ZONE 'Africa/Lagos')::date`;
        if ((daily?.total ?? 0n) + cost.estimatedKobo > profile.schoolDailyKobo) return "SPENDING_LIMIT";
      }
      const row = await db.notificationDelivery.updateMany({
        where: { schoolId, id: job.id, dispatchState: "QUEUED" },
        data: {
          dispatchState: "SENDING", dispatchClaimedAt: now, dispatchRateVersion: cost.rateVersion,
          dispatchEstimateKobo: Number(cost.estimatedKobo),
        },
      });
      return row.count ? "CLAIMED" : "RACED";
    });
    if (claimed === "RACED") return;
    if (claimed !== "CLAIMED") return block(claimed);

    const currentRecipient = async () => (await verified()) === recipient && !!(await this.paymentFacts(job));
    if (account && template) {
      const outcome = await sendMetaTemplate(account, template, recipient, preflight.fields, undefined, fetch, async () => {
        const currentAccount = await this.accounts.activeAccount(schoolId);
        return currentAccount?.token === account.token && await currentRecipient();
      });
      if (outcome.status === "ACCEPTED") {
        return this.finish(job, "SENDING", { state: "ACCEPTED", accountId: account.phoneNumberId, reference: outcome.providerRef });
      }
      return this.finish(job, "SENDING", outcome.status === "BLOCKED"
        ? { state: "BLOCKED", reason: outcome.reason } : { state: "UNKNOWN", reason: "PROVIDER_UNCERTAIN" });
    }

    const configured = this.config.get<string>("MESSAGING_PAID_PLATFORM_DAILY_KOBO");
    const platformDailyKobo = configured && /^[1-9]\d{0,9}$/.test(configured) ? BigInt(configured) : 0n;
    if (platformDailyKobo > 2_147_483_647n || !(await currentRecipient())) {
      return this.finish(job, "SENDING", { state: "BLOCKED", reason: "INVALID_SPEND_CONFIGURATION_OR_RECIPIENT" });
    }
    const reserved = await reserveMessagingCredit(schoolId, `notification:${job.id}`, cost.walletKobo, {
      paidSendingEnabled: true, platformDailyKobo, schoolDailyKobo: profile.schoolDailyKobo,
    });
    if (reserved !== "RESERVED") {
      return this.finish(job, "SENDING", {
        state: reserved === "ALREADY_RESERVED" || reserved === "CONFLICT" ? "UNKNOWN" : "BLOCKED", reason: reserved,
      });
    }
    if (!(await currentRecipient()) || !(await this.preferences.getEnabledChannels(schoolId)).sms) {
      await resolveMessagingCredit(schoolId, `notification:${job.id}`, "RELEASE");
      return this.finish(job, "SENDING", { state: "BLOCKED", reason: "RECIPIENT_OR_CHANNEL_CHANGED" });
    }
    // No fallback and no automatic financial inference. The provider may
    // bill even when the carrier delivers a failed status.
    const outcome = await this.termii.sendSmsWithOutcome(recipient.slice(1), preflight.sms, preflight.senderId);
    if (outcome.status === "ACCEPTED" && outcome.providerRef) {
      return this.finish(job, "SENDING", { state: "ACCEPTED", accountId: profile.termiiAccountId, reference: outcome.providerRef });
    }
    return this.finish(job, "SENDING", { state: "UNKNOWN", reason: "PROVIDER_BILLING_UNRECONCILED" });
  }

  private async paymentFacts(job: NotificationDelivery) {
    return withTenant(job.schoolId, async (db) => {
      const payment = await db.payment.findFirst({
        where: { schoolId: job.schoolId, id: job.eventId, status: "SUCCESS", method: "PAYSTACK", paidAt: { not: null } },
        select: { studentId: true, invoiceId: true, amount: true },
      });
      if (!payment) return null;
      const link = await db.studentGuardian.findFirst({
        where: { schoolId: job.schoolId, studentId: payment.studentId, guardianId: job.principalId },
        select: { student: { select: { firstName: true, lastName: true } } },
      });
      const invoice = await db.invoice.findFirst({
        where: { schoolId: job.schoolId, id: payment.invoiceId },
        select: { totalDue: true, totalPaid: true },
      });
      const school = await db.school.findFirst({
        where: { id: job.schoolId, status: "ACTIVE", suspendedAt: null },
        select: { name: true, smsSenderId: true, smsSenderStatus: true },
      });
      if (!link || !invoice || !school) return null;
      const fields = {
        schoolName: school.name, studentName: `${link.student.firstName} ${link.student.lastName}`,
        amountPaid: formatKobo(payment.amount), balanceLeft: formatKobo(Math.max(0, invoice.totalDue - invoice.totalPaid)),
      };
      return { fields, sms: `${school.name}: We received a school fees payment of ${fields.amountPaid}. Check your parent portal.`, senderId: smsSenderFor(school) };
    });
  }

  private async finish(job: NotificationDelivery, expected: "QUEUED" | "SENDING", decision: Claimed): Promise<void> {
    await withTenant(job.schoolId, (db) => db.notificationDelivery.updateMany({
      where: { schoolId: job.schoolId, id: job.id, dispatchState: expected },
      data: {
        dispatchState: decision.state, dispatchReason: decision.reason,
        providerAccountId: decision.accountId, providerRef: decision.reference,
      },
    }));
  }
}
