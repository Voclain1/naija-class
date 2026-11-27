import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { EmailService } from "../../common/email/email.service";
import { TermiiService, type LegacySmsAttribution } from "../../common/termii/termii.service";
import { PaidMessagingService } from "../notifications/messaging/paid-messaging.service";
import { reviewedMessagingRates } from "../notifications/messaging/messaging-review-controls";
import { quoteDispatchCost } from "../notifications/messaging/messaging-pricing";
import { readVerifiedMessagingRates } from "../notifications/messaging/paid-messaging-policy";
import { NotificationDispatchService, type DeliveryChannel, type NotificationRequest } from "../notifications/notification-dispatch.service";
import { NotificationPreferencesService } from "../notifications/notification-preferences.service";

// The campaign's only way out to families (docs/modules/reminder-campaigns.md).
// A port so tests drive the journal with fake providers, never real families.

export type SendOutcome =
  | { status: "ACCEPTED"; providerRef: string | null }
  | { status: "REJECTED" | "UNKNOWN"; reason: string };

type CampaignWhatsApp = Parameters<PaidMessagingService["queueCampaignReminder"]>[0];

export abstract class ReminderSendPort {
  async whatsappRate(_schoolId: string, _overdue: boolean, _now: Date): Promise<bigint | null> { return null; }
  queueWhatsApp(_input: CampaignWhatsApp): Promise<boolean> { return Promise.resolve(false); }
  abstract emailConfigured(): boolean;
  abstract smsConfigured(schoolId: string): boolean | Promise<boolean>;
  async smsPricePerSegmentKobo(): Promise<bigint | null> { return null; }
  frequencyMinutes(_schoolId: string): number { return 0; }
  abstract enabledChannels(schoolId: string): Promise<{ email: boolean; sms: boolean; push: boolean }>;
  abstract sendEmail(p: { to: string; subject: string; html: string; schoolName: string; idempotencyKey: string }): Promise<SendOutcome>;
  abstract sendSms(to: string, text: string, sender: string | undefined, attribution: LegacySmsAttribution): Promise<SendOutcome>;
  /** Push if the guardian has a live device and push is on, else says SMS or NONE. Sends no SMS itself. */
  abstract pushOrSms(req: NotificationRequest): Promise<DeliveryChannel>;
}

@Injectable()
export class LiveReminderSendPort extends ReminderSendPort {
  constructor(
    private readonly email: EmailService,
    private readonly termii: TermiiService,
    private readonly dispatch: NotificationDispatchService,
    private readonly preferences: NotificationPreferencesService,
    private readonly config: ConfigService,
    private readonly paid: PaidMessagingService,
  ) {
    super();
  }

  emailConfigured(): boolean {
    return this.email.isConfigured;
  }

  async smsConfigured(schoolId: string): Promise<boolean> {
    return (await this.termii.legacyReadiness(schoolId, "REMINDER_CAMPAIGN")).ready;
  }

  override async smsPricePerSegmentKobo(): Promise<bigint | null> {
    const rates = await reviewedMessagingRates("platform", readVerifiedMessagingRates(
      this.config.get<string>("MESSAGING_LEGACY_SMS_RATES") ?? this.config.get<string>("MESSAGING_REMINDER_SMS_RATES"),
    ));
    return quoteDispatchCost(rates, "TERMII_SMS", "SCHOOLKIT", 1, new Date())?.estimatedKobo ?? null;
  }

  override whatsappRate(schoolId: string, overdue: boolean, now: Date): Promise<bigint | null> {
    return this.paid.campaignRate(schoolId, overdue, now);
  }

  override queueWhatsApp(input: CampaignWhatsApp): Promise<boolean> {
    return this.paid.queueCampaignReminder(input);
  }

  override frequencyMinutes(schoolId: string): number {
    try {
      const schools = JSON.parse(this.config.get<string>("REMINDER_FREQUENCY_MINUTES_BY_SCHOOL") ?? "{}") as Record<string, unknown>;
      const minutes = schools[schoolId];
      return typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 1 && minutes <= 43_200 ? minutes : 0;
    } catch {
      return 0;
    }
  }

  enabledChannels(schoolId: string) {
    return this.preferences.getEnabledChannels(schoolId);
  }

  sendEmail(p: { to: string; subject: string; html: string; schoolName: string; idempotencyKey: string }): Promise<SendOutcome> {
    return this.email.sendWithOutcome({ ...p, purpose: "fee-reminder-campaign" });
  }

  sendSms(to: string, text: string, sender: string | undefined, attribution: LegacySmsAttribution): Promise<SendOutcome> {
    return this.termii.sendSmsWithOutcome(to, text, sender, attribution);
  }

  pushOrSms(req: NotificationRequest): Promise<DeliveryChannel> {
    return this.dispatch.notifyGuardian(req);
  }
}
