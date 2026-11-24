import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { EmailService } from "../../common/email/email.service";
import { TermiiService } from "../../common/termii/termii.service";
import { quoteDispatchCost } from "../notifications/messaging/messaging-pricing";
import { readVerifiedMessagingRates } from "../notifications/messaging/paid-messaging-policy";
import { NotificationDispatchService, type DeliveryChannel, type NotificationRequest } from "../notifications/notification-dispatch.service";
import { NotificationPreferencesService } from "../notifications/notification-preferences.service";

// The campaign's only way out to families (docs/modules/reminder-campaigns.md).
// A port so tests drive the journal with fake providers, never real families.

export type SendOutcome =
  | { status: "ACCEPTED"; providerRef: string | null }
  | { status: "REJECTED" | "UNKNOWN"; reason: string };

export abstract class ReminderSendPort {
  abstract emailConfigured(): boolean;
  abstract smsConfigured(): boolean;
  smsPricePerSegmentKobo(): bigint | null { return null; }
  frequencyMinutes(_schoolId: string): number { return 0; }
  abstract enabledChannels(schoolId: string): Promise<{ email: boolean; sms: boolean; push: boolean }>;
  abstract sendEmail(p: { to: string; subject: string; html: string; schoolName: string; idempotencyKey: string }): Promise<SendOutcome>;
  abstract sendSms(to: string, text: string, sender: string | undefined): Promise<SendOutcome>;
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
  ) {
    super();
  }

  emailConfigured(): boolean {
    return this.email.isConfigured;
  }

  smsConfigured(): boolean {
    return this.termii.isConfigured;
  }

  override smsPricePerSegmentKobo(): bigint | null {
    const rates = readVerifiedMessagingRates(this.config.get<string>("MESSAGING_REMINDER_SMS_RATES"));
    return quoteDispatchCost(rates, "TERMII_SMS", "SCHOOLKIT", 1, new Date())?.estimatedKobo ?? null;
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

  sendSms(to: string, text: string, sender: string | undefined): Promise<SendOutcome> {
    return this.termii.sendSmsWithOutcome(to, text, sender);
  }

  pushOrSms(req: NotificationRequest): Promise<DeliveryChannel> {
    return this.dispatch.notifyGuardian(req);
  }
}
