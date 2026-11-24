import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { withTenant, type NotificationDelivery } from "@school-kit/db";
import type { MessagingOverview } from "@school-kit/types";

import { EmailService } from "../../../common/email/email.service";
import { TermiiService } from "../../../common/termii/termii.service";
import { NotificationPreferencesService } from "../notification-preferences.service";
import { isQuietHour } from "../quiet-hours";
import { GuardianMessagingConsentService } from "./guardian-messaging-consent.service";
import { countSmsSegments, quoteDispatchCost } from "./messaging-pricing";
import { getMessagingWallet, reserveMessagingCredit, resolveMessagingCredit } from "./messaging-wallet";
import { MetaConnectionsService } from "./meta-connections.service";
import { sendMetaTemplate } from "./meta-provider";
import { PAID_EVENTS, PAID_PAYMENT_EVENT, readPaidEventFacts, type OtherPaidEvent, type PaidEvent } from "./paid-event-context";
import { parsePaidPlatformLimit, readPaidMessagingProfiles, reviewedEventTemplate, type PaidMessagingProfile } from "./paid-messaging-policy";

export { PAID_PAYMENT_EVENT } from "./paid-event-context";

type Claimed = { state: "SENDING" | "BLOCKED" | "UNKNOWN" | "ACCEPTED"; reason?: string; accountId?: string; reference?: string };

@Injectable()
export class PaidMessagingService {
  private readonly logger = new Logger(PaidMessagingService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly consent: GuardianMessagingConsentService,
    private readonly accounts: MetaConnectionsService,
    private readonly preferences: NotificationPreferencesService,
    private readonly termii: TermiiService,
    private readonly email?: EmailService,
  ) {}

  private profiles() {
    return readPaidMessagingProfiles(this.config.get("MESSAGING_PAID_ENABLED"), this.config.get("MESSAGING_PAID_PAYMENT_PROFILES"));
  }

  private platformLimitKobo(): bigint {
    return parsePaidPlatformLimit(this.config.get<string>("MESSAGING_PAID_PLATFORM_DAILY_KOBO"));
  }

  private async paidEnabled(schoolId: string, channel: string): Promise<boolean> {
    const flags = await this.preferences.getPaidChannels(schoolId);
    return channel === "WHATSAPP" ? flags.paidWhatsAppEnabled : channel === "SMS" && flags.walletSmsEnabled;
  }

  async readiness(schoolId: string, availableKobo: bigint, now = new Date()) {
    const profile = this.profiles().find((item) => item.schoolId === schoolId);
    const sms: MessagingOverview["providers"][number] = { channel: "SMS", ready: false, blockers: ["CHANNEL_DISABLED"] };
    const whatsapp: MessagingOverview["providers"][number] = { channel: "WHATSAPP", ready: false, blockers: ["CHANNEL_DISABLED"] };
    if (profile?.channel === "SMS") {
      sms.blockers = [];
      const price = quoteDispatchCost(profile.rates, "TERMII_SMS", "SCHOOLKIT", 1, now);
      if (!price) sms.blockers.push("PRICE_MISSING");
      else if (availableKobo < price.walletKobo) sms.blockers.push("INSUFFICIENT_CREDIT");
      if (this.platformLimitKobo() === 0n) sms.blockers.push("SPENDING_LIMIT");
      if (!this.termii.isConfigured || !profile.termiiAccountId || profile.termiiAccountId !== this.config.get("MESSAGING_TERMII_PAID_ACCOUNT_ID")) {
        sms.blockers.push("PROVIDER_UNAVAILABLE");
      }
      if (!(await this.paidEnabled(schoolId, "SMS")) || !(await this.preferences.getEnabledChannels(schoolId)).sms) {
        sms.blockers.push("CHANNEL_DISABLED");
      }
      sms.ready = sms.blockers.length === 0;
    }
    if (profile?.channel === "WHATSAPP") {
      whatsapp.blockers = [];
      const template = reviewedEventTemplate(profile, "fee_payment_confirmation", now);
      if (!template) whatsapp.blockers.push("TEMPLATE_NOT_APPROVED");
      else if (!quoteDispatchCost(profile.rates, `META_${template.category}`, "SCHOOL_OWNED", 1, now)) whatsapp.blockers.push("PRICE_MISSING");
      if (!(await this.accounts.activeAccount(schoolId))) whatsapp.blockers.push("PROVIDER_UNAVAILABLE");
      if (!(await this.paidEnabled(schoolId, "WHATSAPP"))) whatsapp.blockers.push("CHANNEL_DISABLED");
      whatsapp.ready = whatsapp.blockers.length === 0;
    }
    return { sms, whatsapp, lowBalance: profile?.lowBalanceKobo !== undefined ? availableKobo < profile.lowBalanceKobo : null };
  }

  private async alertLowBalance(schoolId: string, profile: PaidMessagingProfile, now: Date): Promise<void> {
    if (!profile.lowBalanceKobo || !this.email?.isConfigured) return;
    try {
      if ((await getMessagingWallet(schoolId)).availableKobo >= profile.lowBalanceKobo) return;
      if (!(await this.preferences.getEnabledChannels(schoolId)).email) return;
      const day = new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);
      const owners = await withTenant(schoolId, (db) => db.user.findMany({
        where: { schoolId, isActive: true, emailVerified: true, email: { not: null }, roles: { some: { role: { key: "owner" } } } },
        select: { id: true, email: true },
      }));
      for (const owner of owners) {
        const claimed = await withTenant(schoolId, (db) => db.notificationDelivery.createMany({
          skipDuplicates: true,
          data: [{ schoolId, eventId: day, eventType: "messaging.wallet-low-balance", principalType: "STAFF", principalId: owner.id, channel: "EMAIL" }],
        }));
        if (claimed.count && owner.email) await this.email.send({
          to: owner.email, purpose: "messaging-wallet-low-balance", subject: "Your SchoolKit messaging balance is low",
          html: "<p>Your school's messaging wallet is below its configured threshold. Sign in to SchoolKit to review the balance.</p>",
        });
      }
    } catch {
      this.logger.warn("Could not send messaging wallet low-balance notification");
    }
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

  campaignRate(schoolId: string, overdue: boolean, now: Date): bigint | null {
    const profile = this.profiles().find((item) => item.schoolId === schoolId && item.channel === "WHATSAPP");
    if (!profile) return null;
    const name = overdue ? "fee_payment_overdue" : "fee_payment_reminder";
    const template = reviewedEventTemplate(profile, name, now);
    if (!template) return null;
    return quoteDispatchCost(profile.rates, `META_${template.category}`, "SCHOOL_OWNED", 1, now)?.estimatedKobo ?? null;
  }

  async queueCampaignReminder(input: {
    schoolId: string; invoiceId: string; sendId: string; guardianId: string; overdue: boolean;
  }): Promise<boolean> {
    const { schoolId, invoiceId, sendId, guardianId, overdue } = input;
    if (this.campaignRate(schoolId, overdue, new Date()) === null || !(await this.paidEnabled(schoolId, "WHATSAPP"))) return false;
    await withTenant(schoolId, (db) => db.notificationDelivery.createMany({
      skipDuplicates: true,
      data: [{
        schoolId, eventType: overdue ? "messaging.fee-overdue" : "messaging.fee-reminder", eventId: `${invoiceId}:${sendId}`,
        channel: "WHATSAPP", principalType: "GUARDIAN", principalId: guardianId, dispatchState: "QUEUED",
      }],
    }));
    return true;
  }

  async queueEvent(schoolId: string, eventType: OtherPaidEvent, eventId: string, guardians: readonly string[], notBefore?: Date): Promise<void> {
    const profile = this.profiles().find((item) => item.schoolId === schoolId);
    if (profile?.channel !== "WHATSAPP" || !reviewedEventTemplate(profile, PAID_EVENTS[eventType], new Date()) || !guardians.length) return;
    try {
      await withTenant(schoolId, (db) => db.notificationDelivery.createMany({
        skipDuplicates: true, data: [...new Set(guardians)].map((guardianId) => ({
          schoolId, eventId, eventType, principalType: "GUARDIAN",
          principalId: guardianId, channel: "WHATSAPP", dispatchState: "QUEUED", dispatchNotBefore: notBefore,
        })),
      }));
    } catch {
      this.logger.warn("Could not queue a paid school notification");
    }
  }

  async queueStudents(schoolId: string, eventType: OtherPaidEvent, eventId: string, studentIds: readonly string[]) {
    if (!this.profiles().some((item) => item.schoolId === schoolId && item.channel === "WHATSAPP" &&
        reviewedEventTemplate(item, PAID_EVENTS[eventType], new Date())) || !studentIds.length) return;
    try {
      const links = await withTenant(schoolId, (db) => db.studentGuardian.findMany({
        where: { schoolId, studentId: { in: [...studentIds] }, guardian: { portalDisabledAt: null } },
        select: { guardianId: true },
      }));
      await this.queueEvent(schoolId, eventType, eventId, links.map(({ guardianId }) => guardianId));
    } catch {
      this.logger.warn("Could not find recipients for a paid school notification");
    }
  }

  async queueInvoices(schoolId: string, invoiceIds: readonly string[]): Promise<void> {
    if (!invoiceIds.length || !this.profiles().some((item) => item.schoolId === schoolId && item.channel === "WHATSAPP" &&
        reviewedEventTemplate(item, PAID_EVENTS["messaging.invoice-issued"], new Date()))) return;
    try {
      await withTenant(schoolId, async (db) => {
        const invoices = await db.invoice.findMany({
          where: { schoolId, id: { in: [...invoiceIds] }, issuedAt: { not: null } }, select: { id: true, studentId: true },
        });
        const links = await db.studentGuardian.findMany({
          where: {
            schoolId, studentId: { in: invoices.map(({ studentId }) => studentId) },
            guardian: { portalDisabledAt: null },
          },
          select: { studentId: true, guardianId: true },
        });
        const guardians = new Map<string, string[]>();
        for (const { studentId, guardianId } of links) {
          const ids = guardians.get(studentId) ?? [];
          ids.push(guardianId);
          guardians.set(studentId, ids);
        }
        await db.notificationDelivery.createMany({
          skipDuplicates: true,
          data: invoices.flatMap(({ id, studentId }) => (guardians.get(studentId) ?? []).map((guardianId) => ({
            schoolId, eventId: id, eventType: "messaging.invoice-issued", principalType: "GUARDIAN",
            principalId: guardianId, channel: "WHATSAPP", dispatchState: "QUEUED",
          }))),
        });
      });
    } catch {
      this.logger.warn("Could not queue paid invoice notifications");
    }
  }

  async queueExam(schoolId: string, sittingId: string): Promise<void> {
    if (!this.profiles().some((item) => item.schoolId === schoolId && item.channel === "WHATSAPP" &&
        reviewedEventTemplate(item, PAID_EVENTS["messaging.exam-published"], new Date()))) return;
    try {
      const candidates = await withTenant(schoolId, (db) => db.cbtCandidate.findMany({
        where: { schoolId, sittingId }, select: { studentId: true },
      }));
      await this.queueStudents(schoolId, "messaging.exam-published", sittingId, candidates.map(({ studentId }) => studentId));
    } catch {
      this.logger.warn("Could not queue a paid exam notification");
    }
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
          schoolId, eventType: { in: Object.keys(PAID_EVENTS) }, dispatchState: "SENDING",
          dispatchClaimedAt: { lt: new Date(now.getTime() - 15 * 60_000) },
        },
        data: { dispatchState: "UNKNOWN", dispatchReason: "INTERRUPTED" },
      });
      return db.notificationDelivery.findMany({
        where: {
          schoolId, eventType: { in: Object.keys(PAID_EVENTS) }, dispatchState: "QUEUED",
          OR: [{ dispatchNotBefore: null }, { dispatchNotBefore: { lte: now } }],
        },
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
    const preflight = await readPaidEventFacts(job, now);
    const recipient = await verified();
    const template = channel === "WHATSAPP" ? reviewedEventTemplate(profile, PAID_EVENTS[job.eventType as PaidEvent], now) : undefined;
    const account = template && await this.accounts.activeAccount(schoolId);
    const sms = channel === "SMS" && profile.termiiAccountId && profile.termiiAccountId === this.config.get("MESSAGING_TERMII_PAID_ACCOUNT_ID") &&
      this.termii.isConfigured &&
      (await this.preferences.getEnabledChannels(schoolId)).sms;
    const block = (reason: string) => this.finish(job, "QUEUED", { state: "BLOCKED", reason });
    if (channel !== profile.channel) return block("CHANNEL_CHANGED");
    if (!(await this.paidEnabled(schoolId, channel))) return block("CHANNEL_DISABLED");
    if (now.getTime() - job.sentAt.getTime() > 48 * 60 * 60_000) return block("EXPIRED");
    if (preflight === "WAIT_LINK") {
      await withTenant(schoolId, (db) => db.notificationDelivery.updateMany({
        where: { schoolId, id: job.id, dispatchState: "QUEUED" },
        data: { dispatchNotBefore: new Date(now.getTime() + 15 * 60_000) },
      }));
      return;
    }
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

    const currentRecipient = async () => {
      if (!(await this.paidEnabled(schoolId, channel)) || (await verified()) !== recipient) return false;
      const latest = await readPaidEventFacts(job, now);
      return !!latest && latest !== "WAIT_LINK" && latest.paymentCode === preflight.paymentCode &&
        JSON.stringify(latest.fields) === JSON.stringify(preflight.fields);
    };
    if (account && template) {
      const outcome = await sendMetaTemplate(account, template, recipient, preflight.fields, preflight.paymentCode, fetch, async () => {
        const currentAccount = await this.accounts.activeAccount(schoolId);
        return currentAccount?.token === account.token && await currentRecipient();
      });
      if (outcome.status === "ACCEPTED") {
        return this.finish(job, "SENDING", { state: "ACCEPTED", accountId: account.phoneNumberId, reference: outcome.providerRef });
      }
      return this.finish(job, "SENDING", outcome.status === "BLOCKED"
        ? { state: "BLOCKED", reason: outcome.reason } : { state: "UNKNOWN", reason: "PROVIDER_UNCERTAIN" });
    }

    const platformDailyKobo = this.platformLimitKobo();
    if (platformDailyKobo === 0n || !(await currentRecipient())) {
      return this.finish(job, "SENDING", { state: "BLOCKED", reason: "INVALID_SPEND_CONFIGURATION_OR_RECIPIENT" });
    }
    const reserved = await reserveMessagingCredit(schoolId, `notification:${job.id}`, cost.walletKobo, {
      paidSendingEnabled: true, platformDailyKobo, schoolDailyKobo: profile.schoolDailyKobo,
    });
    if (reserved !== "RESERVED") {
      if (reserved === "INSUFFICIENT_CREDIT") await this.alertLowBalance(schoolId, profile, now);
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
      await this.finish(job, "SENDING", { state: "ACCEPTED", accountId: profile.termiiAccountId, reference: outcome.providerRef });
    } else {
      await this.finish(job, "SENDING", { state: "UNKNOWN", reason: "PROVIDER_BILLING_UNRECONCILED" });
    }
    await this.alertLowBalance(schoolId, profile, now);
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
