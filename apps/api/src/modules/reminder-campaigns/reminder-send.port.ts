import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { EmailService } from "../../common/email/email.service";
import { TermiiService } from "../../common/termii/termii.service";
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
    const amount = this.config.get<string>("REMINDER_SMS_SEGMENT_PRICE_KOBO");
    return amount && /^[1-9]\d{0,9}$/.test(amount) ? BigInt(amount) : null;
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
